# src/

Source root for the `opencode-mem` OpenCode plugin — a persistent memory system that captures, stores, and retrieves project and user knowledge across coding sessions.

## Responsibility

This directory contains the three top-level files that form the plugin's entry surface, plus three subdirectories that house all runtime logic:

- **`plugin.ts`** — ESM plugin module export (`PluginModule`). Imports `index.ts` dynamically, reads `package.json` for the plugin `id`, and exports the default module that OpenCode loads.
- **`index.ts`** — Plugin factory function (`OpenCodeMemPlugin`). Orchestrates initialization and registers all handlers (`chat.message`, `tool.memory`, `event`).
- **`config.ts`** — Configuration loader. Reads `~/.config/opencode/opencode-mem.jsonc` (global) and `.opencode/opencode-mem.jsonc` (project-local), merges them, validates required fields, and exports the resolved `CONFIG` object.

Subdirectories:

- **`services/`** — Core runtime: memory client, embedding, auto-capture, storage, web server, AI providers, privacy, tagging, context formatting, user profile learning.
- **`types/`** — Shared TypeScript type definitions.
- **`web/`** — Web UI (Memory Explorer) served by the built-in HTTP server.

## Design

- **Plugin lifecycle**: `plugin.ts` → dynamic import of `index.ts` → `OpenCodeMemPlugin(ctx)` is called by OpenCode at startup. Returns a handler map (`chat.message`, `tool`, `event`).
- **Config architecture**: Two-layer config (global + project-local) loaded from JSONC files. Secrets support `env://` and `file://` prefixes via `resolveSecretValue`. Defaults are hardcoded; `buildConfig()` deep-merges file config onto defaults. `initConfig(directory)` is called once at plugin startup and re-validates.
- **Graceful degradation**: If required config fields (`postgres.url`, `embeddingModel`, `embeddingApiUrl`, `embeddingApiKey`) are missing, `isConfigured()` returns false and all handlers bail out early with no-ops.
- **Fire-and-forget warmup**: Embedding model warmup (`memoryClient.warmup()`) runs async without blocking the plugin loader to avoid TUI hangs. Uses a global symbol guard to run only once across hot-reloads.

## Flow

1. **OpenCode loads `plugin.ts`** → dynamic import of `index.ts` → exports `PluginModule` with `server: OpenCodeMemPlugin`.
2. **OpenCode calls `OpenCodeMemPlugin(ctx)`** with `{ directory }`.
3. **`initConfig(directory)`** loads global config, then project-local config, merges, validates. Exports resolved `CONFIG`.
4. **Repositories created**: `createUserPromptRepository()` and `createUserProfileRepository()` (depend on `CONFIG`).
5. **Tags resolved**: `getTags(directory)` gathers user/project identity (git email, project path, repo URL).
6. **Async warmup**: `memoryClient.warmup()` fires in background (embedding model load + vector index rebuild).
7. **Provider init**: `opencode-provider` is initialized with OpenCode's server URL and connected provider list.
8. **Web server started** (if `CONFIG.webServerEnabled`): HTTP server on configurable port/host with CORS.
9. **Signal handlers** registered for graceful shutdown (SIGINT/SIGTERM).
10. **Handler map returned** to OpenCode:
    - `chat.message` — Injects memory context into user messages; saves prompts for auto-capture.
    - `tool.memory` — Exposes `add`, `search`, `profile`, `list`, `forget`, `help` subcommands.
    - `event` — Handles `session.idle` (triggers auto-capture + profile learning) and `session.compacted` (restores session memories).

## Integration

- **Exported entry**: `plugin.ts` is the ESM entry (referenced by `package.json` exports). It re-exports `OpenCodeMemPlugin` and provides the `PluginModule` default export.
- **Config contract**: `config.ts` exports `CONFIG` (the resolved config object), `initConfig()`, `isConfigured()`, and `getConfigErrors()`. All services import from here.
- **Service wiring**: `index.ts` imports from `services/` subdirectories (`client`, `context`, `tags`, `privacy`, `auto-capture`, `user-memory-learning`, `storage/factory`, `web-server`, `logger`, `language-detector`, `ai/opencode-provider`) and wires them together at plugin init time.
- **OpenCode SDK dependencies**: Uses `@opencode-ai/plugin` (types `Plugin`, `PluginInput`, `tool`) and `@opencode-ai/sdk` (type `Part`). Calls `ctx.client.*` APIs for sessions, messages, providers, and TUI toasts.
