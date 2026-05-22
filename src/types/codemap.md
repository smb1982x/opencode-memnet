# src/types/

## Responsibility

Shared TypeScript type definitions consumed across the entire opencode-mem plugin. Provides the canonical contracts for memory metadata classification and AI provider discrimination.

## Design

- **Single barrel file** (`index.ts`) — all types re-exported from one module; consumers import from `"../types/index.js"`.
- **`MemoryType`** is a string alias — intentionally unconstrained to allow arbitrary memory categories without code changes.
- **`MemoryMetadata`** is an open interface — typed optional fields for common provenance (source, session, tool, git info, user identity) plus a `[key: string]: unknown` catch-all for extension.
- **`AIProviderType`** is a string union — currently only `"openai-chat"`, designed to grow as additional LLM backends are added.

## Flow

- Types are pure declarations — no runtime logic, no I/O, no side effects.
- `MemoryMetadata` flows into memory-write calls (client, API handlers) and out of storage as persisted JSONB.
- `MemoryType` is threaded through the same write/search path as a lightweight category label.
- `AIProviderType` is consumed by the AI provider factory to select the correct LLM backend.

## Integration

- **Consumed by:** `src/index.ts` (plugin hooks), `src/services/client.ts` (`LocalMemoryClient`), `src/services/api-handlers.ts` (HTTP routes).
- **Depends on:** nothing — this is a leaf module with zero external imports.
