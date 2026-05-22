# src/services/

## Responsibility

The services layer owns all core business logic for OpenCode-mem: memory CRUD, vector embedding and search, conversation auto-capture, user profiling, data maintenance (cleanup, deduplication, migration), and the HTTP API server. It is the middle layer between the plugin entry point and the SQLite/nested submodules.

## Design Patterns

| File | Pattern | Role |
|------|---------|------|
| **client.ts** | Facade | `LocalMemoryClient` wraps embedding + shard + vector-search into high-level `addMemory`, `searchMemories`, `deleteMemory`, `listMemories`. Singleton `memoryClient`. |
| **embedding.ts** | Singleton + Lazy Init | `EmbeddingService.getInstance()` via `Symbol.for(...)`. Warmup is lazy/idempotent. In-process LRU cache (100 entries). Supports local `@xenova/transformers` pipeline or remote API. |
| **api-handlers.ts** | Request Adapter | Stateless async functions translating HTTP semantics to service calls. Each handler is self-contained, delegates to submodules. Lazy-imports heavy deps (cleanup, dedup, migration) to keep worker thread responsive. |
| **web-server.ts** / **web-server-worker.ts** | Strategy | Two server implementations sharing the same `api-handlers` import. Main-thread `WebServer` class with port-takeover logic; `web-server-worker` runs in a `Bun.serve` inside a `Worker` `onmessage` loop. |
| **tags.ts**, **privacy.ts**, **jsonc.ts**, **secret-resolver.ts**, **language-detector.ts**, **logger.ts** | Utility | Stateless pure/helper functions. No classes, no significant state. |
| **cleanup-service.ts**, **deduplication-service.ts**, **migration-service.ts** | Service + Guard | Class with `isRunning` guard, `getStatus()`, async run method. Singleton exports. Dedup and migration additionally gate on config flags. |
| **auto-capture.ts**, **user-memory-learning.ts** | Orchestrator | Async functions gated by a module-level `isRunning` flag. Orchestrate multiple sub-service calls (userPromptManager, memoryClient, AI provider). |
| **context.ts** | Formatter | Pure function `formatContextForPrompt` composing memory results + profile context into a prompt injection string. |

## Data & Control Flow

### Memory Write Path (addMemory / handleAddMemory)
```
caller → client.addMemory() / handleAddMemory()
  → embeddingService.warmup() [lazy]
  → embeddingService.embedWithTimeout(content) → Float32Array
  → tags.join(",") → embedWithTimeout (optional tagsVector)
  → extractScopeFromContainerTag → scope + hash
  → shardManager.getWriteShard(scope, hash) → shard
  → connectionManager.getConnection(shard.dbPath) → db
  → vectorSearch.insertVector(db, record, shard)
  → shardManager.incrementVectorCount(shard.id)
```

### Memory Read/Search Path
```
caller → client.searchMemories() / handleSearch()
  → embeddingService.warmup() [lazy, search only]
  → embedWithTimeout(query)
  → shardManager.getAllShards(scope, hash)
  → vectorSearch.searchAcrossShards(shards, vector, tag, ...)
    → per shard: cosine similarity via SQLite FTS5 + rowid intersection
  → merge + sort by similarity
  → (handleSearch) also fetches prompts via userPromptManager.searchPrompts()
  → pair linked memories/prompts, fetch missing context items
```

### Auto-Capture Flow
```
after AI response → performAutoCapture(ctx, sessionID, directory)
  → userPromptManager.getLastUncapturedPrompt(sessionID) → claimPrompt()
  → fetch session messages via ctx.client.session.messages()
  → extractAIContent() → textResponses + toolCalls
  → getTags(directory) for project tagging
  → getLatestProjectMemory() via client.listMemories()
  → buildMarkdownContext() + generateSummary() via LLM
  → if type ≠ "skip": client.addMemory() → linkMemoryToPrompt() → markAsCaptured()
```

### User Profile Learning Flow
```
after AI response → performUserProfileLearning(ctx, directory)
  → userPromptManager.countUnanalyzedForUserLearning() >= threshold
  → getPromptsForUserLearning(threshold)
  → getTags(directory) for userId
  → userProfileManager.getActiveProfile(userId)
  → buildUserAnalysisContext(prompts, existingProfile)
  → analyzeUserProfile() via LLM (opencode provider or external tool-call)
  → merge new data → userProfileManager.createProfile()/updateProfile()
  → markMultipleAsUserLearningCaptured()
```

### Cleanup / Dedup / Migration
All follow the same guarded singleton pattern:
```
trigger → service.run*()
  → check isRunning guard
  → iterate all shards (user + project)
  → for each shard: query memories, apply logic (delete by age / exact+cosine dedup / re-embed)
  → report result
```
- **Cleanup**: retention-based expiry, skips pinned + linked memories.
- **Deduplication**: exact match via contentMap, near-duplicate via cosine similarity on vectors.
- **Migration**: detects dimension/model mismatches via `shard_metadata` table, offers `fresh-start` (delete shards) or `re-embed` (recompute all vectors).

### HTTP Server Flow
```
plugin → startWebServer(config)
  → new WebServer(config).start()
  → Bun.serve({ fetch: handleRequest })
  → each route: parse URL → call api-handler → jsonResponse()
  → if port in use: enter health-check + takeover loop (every 5s)
  → web-server-worker variant: same handleRequest, driven by Worker onmessage
```

## Integration Points

| File | Integrates With |
|------|----------------|
| **client.ts** | `./embedding.ts`, `./sqlite/shard-manager.ts`, `./sqlite/vector-search.ts`, `./sqlite/connection-manager.ts`, `../config.ts`, `../types` |
| **embedding.ts** | `../config.ts` (model, API URL/key), `@xenova/transformers` (local), remote HTTP API (remote) |
| **api-handlers.ts** | `./embedding.ts`, `./sqlite/shard-manager.ts`, `./sqlite/vector-search.ts`, `./sqlite/connection-manager.ts`, `./logger.ts`, `./cleanup-service.ts` (lazy), `./deduplication-service.ts` (lazy), `./migration-service.ts` (lazy), `./tags.ts` (lazy), `./user-prompt/user-prompt-manager.ts`, `./user-profile/user-profile-manager.ts` (lazy), `./ai/ai-provider-factory.ts` (lazy), `./ai/provider-config.ts` (lazy), `./ai/opencode-provider.ts` (lazy), `./language-detector.ts` (lazy), `../config.ts` |
| **auto-capture.ts** | `./client.ts`, `./tags.ts`, `./logger.ts`, `./user-prompt/user-prompt-manager.ts`, `../config.ts`, `./ai/opencode-provider.ts` (lazy), `./ai/ai-provider-factory.ts` (lazy), `./ai/provider-config.ts` (lazy), `./language-detector.ts` (lazy), `@opencode-ai/plugin` types |
| **user-memory-learning.ts** | `./tags.ts`, `./logger.ts`, `./user-prompt/user-prompt-manager.ts`, `./user-profile/user-profile-manager.ts`, `./user-profile/types.ts`, `../config.ts`, `./ai/opencode-provider.ts` (lazy), `./ai/ai-provider-factory.ts` (lazy), `./ai/provider-config.ts` (lazy), `@opencode-ai/plugin` types |
| **cleanup-service.ts** | `./sqlite/shard-manager.ts`, `./sqlite/vector-search.ts`, `./sqlite/connection-manager.ts`, `./user-prompt/user-prompt-manager.ts`, `../config.ts`, `./logger.ts` |
| **deduplication-service.ts** | `./sqlite/shard-manager.ts`, `./sqlite/vector-search.ts`, `./sqlite/connection-manager.ts`, `../config.ts`, `./logger.ts` |
| **migration-service.ts** | `./sqlite/shard-manager.ts`, `./sqlite/connection-manager.ts`, `./sqlite/vector-search.ts`, `./embedding.ts`, `../config.ts`, `./logger.ts` |
| **context.ts** | `../config.ts`, `./user-profile/profile-context.ts` |
| **tags.ts** | `../config.ts`, `node:child_process` (git commands), `node:crypto`, `node:fs`, `node:path` |
| **web-server.ts** | All `./api-handlers.ts` exports, `./logger.ts`, `node:fs` + `node:path` (static files from `../web/`) |
| **web-server-worker.ts** | All `./api-handlers.ts` exports, `node:fs` + `node:path` (static files from `../web/`), communicates via `postMessage` |
| **language-detector.ts** | `franc-min`, `iso-639-3` |
| **logger.ts** | `node:fs`, `node:os`, `node:path`, env var `OPENCODE_MEM_LOG_FILE` |
| **jsonc.ts**, **privacy.ts**, **secret-resolver.ts** | No internal deps (pure utility) |
