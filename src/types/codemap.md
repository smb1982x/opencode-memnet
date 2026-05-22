# src/types/

## Responsibility

Provides the **shared/public type definitions** and **ambient module declarations** that are consumed across the plugin's service layer and API surface. This folder is the single source of truth for primitive type contracts — memory identifiers, metadata shapes, and AI provider enums — that multiple independent modules (client, index, API handlers, AI session manager) must agree on without circular dependencies.

It also hosts `.d.ts` ambient declarations for third-party packages that lack their own type definitions, keeping type-patching isolated from business logic.

## Design Patterns

- **Lightweight Barrel** — `index.ts` re-exports a small set of brand-like and structural types. No class, no function, no runtime code — pure type-level contracts.
- **Branded Type (string alias)** — `MemoryType` is `string` rather than a union, allowing open-ended tag values (e.g. `"conversation"`, `"code"`, `"decision"`) while remaining nominal in intent. Convention-driven rather than exhaustively enumerated.
- **Index-Signature Metadata Bag** — `MemoryMetadata` uses `[key: string]: unknown` to remain extensible by any service that needs to attach custom fields (reasoning traces, user identifiers, git context) without tight coupling.
- **Ambient Module Shims** — `usearch.d.ts` uses `declare module "usearch"` to satisfy TypeScript for an optional-heavy dependency that is dynamically `import()`-ed at runtime by the vector-backend layer. This avoids a hard peer-dep on `@types/usearch`.

## Data & Control Flow

```text
types/index.ts
  │
  ├── MemoryType (= string)
  │     ├── src/services/client.ts          — memoryClient.addMemory(..., type)
  │     ├── src/services/api-handlers.ts    — REST endpoint type param
  │     └── src/index.ts                    — tool "add" handler
  │
  ├── MemoryMetadata (interface)
  │     ├── stored alongside memory records in SQLite (JSON column)
  │     ├── populated by auto-capture, manual add, import, API
  │     └── used by context formatters & user-profile learning
  │
  └── AIProviderType (union: "openai-chat" | "openai-responses" | "anthropic")
        └── src/services/ai/session/ai-session-manager.ts
              └── narrower contract vs the 4-variant version in
                  src/services/ai/session/session-types.ts
                  (the latter adds "google-gemini" for internal use)

types/usearch.d.ts
  └── declare module "usearch"
        └── src/services/vector-backends/usearch-backend.ts
              └── import("usearch") at runtime, no compile-time type check
```

**Key distinction**: This folder's `AIProviderType` intentionally omits `"google-gemini"` — a narrower public contract. The AI session internals (`session-types.ts`) define a superset that includes Gemini for internal provider routing.

## Integration Points

| Type / Declaration | Consumed By | Role |
|---|---|---|
| `MemoryType` | `services/client.ts`, `services/api-handlers.ts`, `index.ts` | Open-ended string tag for memory classification; used across add/list/search/delete operations |
| `MemoryMetadata` | All memory callers (auto-capture, manual import, API, tools) | Extensible metadata envelope attached to every memory record; consumed by context formatters, profile learners, and storage layer |
| `AIProviderType` (3-variant) | `services/ai/session/ai-session-manager.ts` | Public interface for AI provider selection; internal code (session-types.ts, factory) uses a 4-variant superset |
| `declare module "usearch"` | `services/vector-backends/usearch-backend.ts` | Ambient type shim enabling dynamic `import("usearch")` without a hard dependency on `@types/usearch` |

### Related codemaps

| File | Relationship |
|------|--------------|
| `src/services/ai/session/codemap.md` | Documents the internal `AIProviderType` superset (4 variants) and session types |
| `src/services/client/codemap.md` | Primary consumer of `MemoryType` and `MemoryMetadata` via the memoryClient facade |
| `src/services/api-handlers/codemap.md` | REST API shape that mirrors `MemoryMetadata` fields for external access |
