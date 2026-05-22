# src/

## Responsibility

Entry point and orchestration layer for the opencode-mem plugin. It implements the `@opencode-ai/plugin` interface, exposing lifecycle hooks (`chat.message`, `tool`, `event`) that inject memory context into conversations, provide a semantic memory tool, and drive background auto-capture and user-profile learning on session idle/compaction events.

## Design Patterns

- **Plugin-as-Factory** — `OpenCodeMemPlugin` is a top-level async factory `(ctx: PluginInput) => Plugin`. It initialises config, warms up the embedding model fire-and-forget (via `Symbol.for` global guard to avoid repeated warmup), and returns a `Plugin` object with `chat.message`, `tool`, and `event` handlers.
- **Lazy Imports** — Heavy modules (`opencode-provider`, `user-profile-manager`, `cleanup-service`, `connection-manager`) are dynamically `import()`-ed only when their handler code path is first triggered, keeping cold-start cost low.
- **Config Layering** — `config.ts` merges global (`~/.config/opencode/opencode-mem.jsonc`) and project-local (`.opencode/opencode-mem.jsonc`) config via spread-merge, then normalises with `buildConfig()` which applies defaults, path expansion (`expandPath`), and secret resolution (`resolveSecretValue`). The config template is auto-created on first import via `ensureConfigExists()`.
- **Idle Debounce** — The `session.idle` event uses a 10-second `setTimeout` debounce to batch auto-capture and profile learning, preventing rapid re-triggers.
- **Global Singleton Guards** — `Symbol.for("opencode-mem.plugin.warmedup")` and `isConfigured()` gate one-shot initialisation paths.

## Data & Control Flow

```
plugin.ts → index.ts (OpenCodeMemPlugin) → 
  ├── initConfig(directory)               → config.ts (load, merge, build)
  ├── memoryClient.warmup()               → embedding.ts → ONNX / API model load
  ├── setV2Client / setConnectedProviders → ai/opencode-provider.ts
  ├── startWebServer(...)                 → services/web-server.ts → web-server-worker.ts
  │
  ├── chat.message hook ──► userPromptManager.savePrompt()
  │                           ├── memoryClient.listMemories(tag, limit)
  │                           ├── formatContextForPrompt(userId, memories)
  │                           │     ├── getUserProfileContext()      ← user-profile/profile-context.ts
  │                           │     └── memory results list
  │                           └── output.parts.unshift(contextPart)  ← injects [MEMORY] block
  │
  ├── tool: memory ───────────► execute(args)
  │     ├── "add"    → memoryClient.addMemory(content, tag, metadata)
  │     ├── "search" → memoryClient.searchMemories(query, tag, scope) → vector-search.ts
  │     ├── "list"   → memoryClient.listMemories(tag, limit)
  │     ├── "forget" → memoryClient.deleteMemory(id)
  │     ├── "profile"→ userProfileManager.(getActiveProfile|createProfile|updateProfile)
  │     └── "help"   → usage JSON
  │
  └── event hook ───────────────────────────►
        ├── session.idle (debounced 10s):
        │     ├── performAutoCapture()       → services/auto-capture.ts
        │     │     └── ai-provider-factory → providers/ (openai-chat|openai-responses|anthropic)
        │     ├── performUserProfileLearning() → services/user-memory-learning.ts
        │     ├── cleanupService.runCleanup()   → services/cleanup-service.ts
        │     └── connectionManager.checkpointAll() → services/sqlite/connection-manager.ts
        │
        └── session.compacted:
              ├── memoryClient.searchMemoriesBySessionID()
              └── ctx.client.session.prompt() → restores memories into conversation
```

`memoryClient` (singleton from `services/client.ts`) is the central facade abstracting over the SQLite + vector-backend stack: `shardManager`, `vectorSearch`, `connectionManager`, and `embeddingService`.

## Integration Points

| Interface | Consumed By | Direction |
|-----------|-------------|-----------|
| `@opencode-ai/plugin` `Plugin` / `PluginInput` | `index.ts` ← `plugin.ts` → opencode host | inbound (host calls our hooks) |
| `ctx.client.session.messages / list / prompt` | `chat.message` and `event.compacted` handlers | outbound (opencode API) |
| `ctx.client.tui.showToast` | web-server takeover, errors, compaction restore | outbound (TUI notifications) |
| `ctx.serverUrl` | initialises `v2Client` for opencode provider proxying | init-time |
| `memoryClient` → `embeddingService` | `services/embedding.ts` — ONNX local inference or HTTP API | internal |
| `memoryClient` → `shardManager` | `services/sqlite/shard-manager.ts` — per-project SQLite shard routing | internal |
| `memoryClient` → `vectorSearch` | `services/sqlite/vector-search.ts` — FTS5 + vector ANN queries | internal |
| `memoryClient` → `connectionManager` | `services/sqlite/connection-manager.ts` — WAL checkpoint, lifecycle | internal |
| `memoryClient` → `backend-factory` | `services/vector-backends/` — USearch or exact-scan vector index | internal |
| `userPromptManager` | `services/user-prompt/user-prompt-manager.ts` — persists user messages | side-effect |
| `userProfileManager` | `services/user-profile/user-profile-manager.ts` — CRUD profile versions | side-effect |
| `web-server.ts` | HTTP (Express) server for memory explorer UI, talks to `memoryClient` | outbound |
| `stripPrivateContent` / `isFullyPrivate` | `services/privacy.ts` — content redaction before storage | guard layer |
| `getTags` | `services/tags.ts` — resolves project/user/git metadata from directory | init-time |
| `getLanguageName` | `services/language-detector.ts` — maps config lang code to human name | tool description |

### Subdirectory Layout

```
src/
├── config.ts            — config loading, merging, defaults, template generation
├── index.ts             — plugin factory + all hook implementations (chat.message, tool, event)
├── plugin.ts            — PluginModule re-export with package.json id
├── types/               — shared TS type definitions (MemoryType, MemoryMetadata, AIProviderType)
├── services/            — core business logic
│   ├── ai/              — AI provider abstraction (factory, providers, session management, tool schemas)
│   ├── sqlite/          — SQLite persistence (connection, sharding, vector search, bootstrap)
│   ├── user-profile/    — user preference/pattern/workflow profile CRUD & context rendering
│   ├── user-prompt/     — prompt persistence for user-memory learning
│   ├── vector-backends/ — pluggable vector index backends (USearch, exact-scan)
│   ├── client.ts        — central memoryClient facade
│   ├── embedding.ts     — ONNX / API embedding generation
│   ├── auto-capture.ts  — AI-driven background memory extraction
│   ├── context.ts       — memory context formatting for prompt injection
│   └── ...              — privacy, logger, tags, language-detector, cleanup, dedup, migration, etc.
└── web/                 — static assets for the memory explorer web UI (HTML/CSS/JS/i18n)
```
