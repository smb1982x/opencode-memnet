# Repository Atlas: opencode-mem

## Project Responsibility

`opencode-mem` is an OpenCode plugin that gives coding agents persistent, semantically searchable memory. It captures user prompts, embeds and stores memories in a local vector database, injects relevant context into future chat messages, supports automatic memory capture and user-profile learning, and exposes a local HTTP API/web UI for memory management.

## System Entry Points

- `package.json` — package manifest, build/typecheck scripts, OpenCode plugin metadata, and runtime dependencies (`@opencode-ai/plugin`, `@opencode-ai/sdk`, `@xenova/transformers`, `usearch`).
- `src/plugin.ts` — package-level plugin export shim.
- `src/index.ts` — primary OpenCode plugin factory; wires configuration, chat hooks, tools, event handlers, memory injection, auto-capture, profile learning, and web server startup.
- `src/config.ts` — configuration loader/normalizer for global and project-local `opencode-mem` JSON/JSONC files, defaults, path expansion, and secret resolution.

## Repository Directory Map

| Directory | Responsibility Summary | Detailed Map |
|---|---|---|
| `src/` | Plugin entry point and orchestration layer implementing OpenCode hooks, tool handlers, config initialization, memory context injection, web server startup, and event-driven background workflows. | [View Map](src/codemap.md) |
| `src/services/` | Core service layer for memory CRUD, embedding, semantic search, auto-capture, user profiling, maintenance jobs, HTTP handlers, and utility services. | [View Map](src/services/codemap.md) |
| `src/services/sqlite/` | SQLite persistence layer that bootstraps `bun:sqlite`, manages file connections, shard metadata, per-shard memory tables, vector BLOB storage, and vector-search orchestration. | [View Map](src/services/sqlite/codemap.md) |
| `src/services/vector-backends/` | Pluggable vector search Strategy implementations: USearch ANN, exact-scan cosine fallback, and factory/decorator logic for graceful backend degradation. | [View Map](src/services/vector-backends/codemap.md) |
| `src/services/user-profile/` | User profile persistence and rendering subsystem with versioned profile data, changelog history, safe shape normalization, and prompt-context formatting. | [View Map](src/services/user-profile/codemap.md) |
| `src/services/user-prompt/` | User prompt capture queue and persistence subsystem with optimistic claim states for auto-capture and independent user-learning capture flags. | [View Map](src/services/user-prompt/codemap.md) |
| `src/services/ai/` | AI provider abstraction layer for provider selection, tool-oriented LLM calls, opencode SDK structured output, session integration, and response validation. | [View Map](src/services/ai/codemap.md) |
| `src/services/ai/providers/` | Concrete provider adapters for OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Google Gemini behind a common provider contract. | [View Map](src/services/ai/providers/codemap.md) |
| `src/services/ai/session/` | SQLite-backed AI session store for conversation lifecycle, message sequencing, provider state, expiration, and retention cleanup. | [View Map](src/services/ai/session/codemap.md) |
| `src/services/ai/tools/` | Canonical tool/function schema contracts and provider-specific schema converters for structured memory/profile extraction calls. | [View Map](src/services/ai/tools/codemap.md) |
| `src/services/ai/validators/` | Validation boundary for LLM-produced structured user-profile data before persistence or downstream consumption. | [View Map](src/services/ai/validators/codemap.md) |
| `src/types/` | Shared public TypeScript contracts and ambient declarations, including exported memory/provider types and the `usearch` module shim. | [View Map](src/types/codemap.md) |

## Architectural Flow

1. OpenCode loads `src/plugin.ts` / `src/index.ts`, which initializes configuration and returns plugin hooks.
2. `chat.message` captures user prompts through `user-prompt`, retrieves relevant memories through `LocalMemoryClient`, and injects formatted memory/profile context.
3. The memory tool and HTTP API route user actions to `services/client.ts` or `api-handlers.ts`.
4. Memory writes compute embeddings, resolve scope, choose/create a SQLite shard, persist the record, and update the active vector backend.
5. Memory search embeds the query, searches content and tag vectors through the configured backend, hydrates SQLite rows, applies weighted scoring, and returns ranked results.
6. Idle/session events trigger auto-capture, user-profile learning, cleanup, deduplication, and migration workflows.

## Cross-Cutting Design Patterns

- **Facade** — `LocalMemoryClient` hides embedding, sharding, and vector-search details from plugin/API callers.
- **Strategy** — vector backends and AI providers are selected through interfaces/factories.
- **Singleton** — module-level service instances coordinate SQLite managers, embedding service, vector search, profiles, prompts, and sessions.
- **Lazy Initialization** — heavy dependencies and models are loaded only when needed to reduce plugin cold-start cost.
- **Repository/Data Mapper** — SQLite managers translate between tables and domain records for memories, prompts, profiles, and AI sessions.
- **Event-Driven Orchestration** — OpenCode hooks and idle events drive capture, context injection, and maintenance workflows.

## Root Assets

- `.slim/codemap.json` — codemap state file used for change detection.
- `codemap.md` — this atlas and master entry point.
- `AGENTS.md` — agent-facing pointer that instructs future agents to read the codemap before making changes.
- `package.json` — dependency and script manifest; selected by the codemap because it defines runtime architecture and package entry points.
