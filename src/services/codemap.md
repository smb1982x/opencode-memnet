# src/services/

## Responsibility

- **Core service layer** for opencode-mem: coordinates memory storage, vector embeddings, AI-powered capture/learning, and the web dashboard API.
- Provides the main public facade (`LocalMemoryClient`) that the plugin layer calls into for CRUD and vector search on memories.
- Houses the **auto-capture pipeline** that observes conversations and distills them into saved memories via LLM summarization.
- Runs **user profile learning** — periodic analysis of user prompts to build/maintain behavioral profiles (preferences, patterns, workflows).
- Exposes a **REST API surface** (`api-handlers.ts`) consumed by the built-in web server for the dashboard UI.
- Supplies cross-cutting utilities: tagging/identity, privacy redaction, JSONC parsing, language detection, logging, and secret resolution.

## Design

- **Singleton patterns**: `EmbeddingService` uses a global Symbol key for cross-worker dedup; `memoryClient` and repository factories produce singletons. Module-level flags (`isCaptureRunning`, `isLearningRunning`) prevent concurrent pipeline runs.
- **Lazy initialization**: Both `LocalMemoryClient` and API handlers use an `initialize()` / `ensureInit()` pattern that runs DB migrations once on first use, avoiding heavy startup cost.
- **Two AI provider paths**: Every AI-calling service (auto-capture, user-learning, tag migration) supports (1) an opencode-connected provider via `generateStructuredOutput` with Zod schemas, and (2) a standalone provider via `AIProviderFactory` with function-calling tool schemas.
- **Remote-only embeddings**: `EmbeddingService` calls an OpenAI-compatible `/embeddings` HTTP endpoint. It handles truncation (left/right per kind), caches results keyed by model+text+params, and aborts after 30 s timeout.
- **Scope resolution via container tags**: Memories are partitioned by `{prefix}_{scope}_{hash}` tags (user vs project). `MemoryScope` ("project" | "all-projects") controls whether search/list filters to one project or crosses all.
- **Guarded re-entrancy**: Boolean flags (`isCaptureRunning`, `isLearningRunning`) serialize the auto-capture and profile-learning pipelines to avoid duplicate work when hooks fire concurrently.

## Flow

1. **Plugin hook** receives a user prompt → `tags.ts` resolves user/project identity → prompt is stored unanalyzed.
2. After the AI responds, `auto-capture.ts` claims the uncaptured prompt, fetches AI messages, builds markdown context, and calls an LLM to summarize. If the result is "skip", the prompt is deleted; otherwise the summary is embedded and persisted as a memory via `LocalMemoryClient`.
3. `user-memory-learning.ts` runs on a configurable interval — when enough unanalyzed prompts accumulate, it sends them (plus any existing profile) to an LLM to extract preferences/patterns/workflows, then upserts the profile via `UserProfileRepository`.
4. `context.ts` assembles the `[MEMORY]` injection block: it retrieves the user profile and project memories, formats them with similarity percentages, and returns the string that gets prepended to prompts.
5. **Web dashboard** requests hit `web-server.ts` (or its worker variant) → routes to `api-handlers.ts` functions → handlers call repositories/embedding-service directly, bypassing `LocalMemoryClient` for richer operations (search across memories+prompts, pagination, cascade deletes, tag migration).

## Integration

- **Upstream**: `src/index.ts` (plugin entry) instantiates `LocalMemoryClient`, starts `WebServer`, and hooks `performAutoCapture` / `performUserProfileLearning` into the opencode plugin lifecycle.
- **Storage layer** (`src/services/storage/`): All data access goes through repository interfaces (`MemoryRepository`, `UserPromptRepository`, `UserProfileRepository`) created by `storage/factory.ts`.
- **AI layer** (`src/services/ai/`): Auto-capture, user-learning, and tag migration dynamically import `AIProviderFactory` and `opencode-provider` for LLM calls; embedding uses `CONFIG.embeddingApiUrl` directly via HTTP.
- **Config** (`src/config.ts`): Every service reads from the centralized `CONFIG` singleton for model names, API URLs, thresholds, and feature flags.
- **Tags** (`tags.ts`): Shared by auto-capture, user-learning, and API handlers to resolve container tags from git identity and project paths; results are cached for 1 minute.
