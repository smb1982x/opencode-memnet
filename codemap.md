# Repository Atlas: opencode-mem

## Project Responsibility

`opencode-mem` is an OpenCode plugin that gives coding agents persistent, semantically searchable memory. It captures user prompts, embeds them via a remote OpenAI-compatible API (1024-dim vectors), stores memories in PostgreSQL with pgvector HNSW indexes, injects relevant context into future chat messages, supports automatic memory capture and user-profile learning, and exposes a local HTTP API and Management WebUI for memory management.

## System Entry Points

- **`src/index.ts`** — primary OpenCode plugin factory; wires configuration, chat hooks, tools, event handlers, memory injection, auto-capture, profile learning, and web server startup.
- **`src/config.ts`** — configuration loader/normalizer for global and project-local `opencode-mem` JSON/JSONC files, defaults, path expansion, and secret resolution. Validates required fields: `postgres.url`, `embeddingApiUrl`, `embeddingModel`.

## Core Modules

### Embedding — `src/services/embedding.ts`

Calls a remote OpenAI-compatible `/v1/embeddings` endpoint. Produces 1024-dimensional vectors used for semantic memory search. Stateless service consumed by `LocalMemoryClient`.

### AI Provider — `src/services/ai/`

Single provider: **OpenAI Chat Completions** (`providers/openai-chat-completion.ts`). Used for structured memory/profile extraction via tool calls. Supporting modules:

- `ai-provider-factory.ts` — resolves and creates the provider instance.
- `opencode-provider.ts` — opencode SDK structured-output integration.
- `provider-config.ts` — provider configuration resolution.
- `tools/` — canonical tool/function schema contracts for memory/profile extraction.
- `validators/` — validation of LLM-produced structured user-profile data.

### Postgres Storage — `src/services/storage/postgres/`

Postgres + pgvector implementations:

- Lazy client singleton and vector utilities.
- HNSW-backed memory search with weighted scoring (content × 0.6 + tags × 0.4).
- Tri-state prompt capture, JSONB profile data, TTL-based AI sessions.
- Repository interfaces: `MemoryRepository`, `UserPromptRepository`, `UserProfileRepository`, `AISessionRepository`.

### API Handlers — `src/services/api-handlers.ts`

HTTP request handlers for the local API server. Routes user actions (CRUD, search) to `LocalMemoryClient`.

### Supporting Services

- `src/services/client.ts` — `LocalMemoryClient` facade hiding embedding and storage details.
- `src/services/auto-capture.ts` — idle-event-driven automatic memory capture.
- `src/services/user-memory-learning.ts` — user-profile learning workflows.
- `src/services/web-server.ts` / `web-server-worker.ts` — local HTTP server and Management WebUI.
- `src/services/context.ts` — memory context formatting for chat injection.
- `src/services/tags.ts` — tag extraction for memories.

### Types — `src/types/`

Shared public TypeScript contracts, including exported memory and provider types.

## Architectural Flow

1. OpenCode loads `src/index.ts`, which initializes configuration and returns plugin hooks.
2. `chat.message` captures user prompts, retrieves relevant memories via `LocalMemoryClient` (backed by Postgres + pgvector), and injects formatted memory/profile context.
3. Memory tool and HTTP API route user actions through `api-handlers.ts` → `LocalMemoryClient`.
4. Memory writes compute 1024-dim embeddings via the OpenAI-compatible API, resolve scope, and persist to Postgres with pgvector HNSW indexing.
5. Memory search embeds the query, runs HNSW search (content + tags vectors), and applies weighted scoring in TypeScript.
6. Idle/session events trigger auto-capture and user-profile learning workflows.

## Cross-Cutting Design Patterns

- **Facade** — `LocalMemoryClient` hides embedding and storage details from plugin/API callers.
- **Repository** — storage interfaces decouple business logic from Postgres implementation.
- **Singleton** — module-level instances coordinate embedding, repositories, and AI provider.
- **Lazy Initialization** — Postgres client and repositories created on first use.
- **Event-Driven Orchestration** — OpenCode hooks and idle events drive capture, context injection, and profile learning.

## Root Assets

- `codemap.md` — this atlas.
- `AGENTS.md` — agent-facing pointer to read the codemap before making changes.
- `package.json` — dependency and script manifest.
