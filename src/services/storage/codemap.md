# Storage Layer (`src/services/storage/`)

## Responsibility

Postgres-only data persistence and retrieval. Exposes typed repository
interfaces consumed by the rest of the application; hides all SQL and
pgvector details behind a thin factory.

## Design

- **Factory pattern** — `factory.ts` exports singleton creators
  (`createMemoryRepository`, `createUserPromptRepository`, etc.) and
  lifecycle helpers (`initializeStorage`, `closeStorage`).
- **Lazy proxies** — Each factory function returns a lightweight proxy
  class that dynamically imports the real Postgres implementation on
  first method call, keeping the `pg` client out of the initial bundle.
- **Repository pattern** — Every domain aggregate has its own interface
  defined in `types.ts` and a single Postgres implementation in
  `postgres/`. No backend switching; Postgres is the only backend.

## Interfaces (`types.ts`)

| Interface               | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `MemoryRepository`      | Vector memory CRUD, similarity search, pinning, cleanup |
| `UserPromptRepository`  | Capture/analytics lifecycle for user prompts            |
| `UserProfileRepository` | User profile CRUD with confidence-based merge           |
| `AISessionRepository`   | AI session + message persistence & expiry               |

Shared row/result types (`MemoryRow`, `SearchResult`, `UserPromptRow`,
`UserProfileRow`, `AISessionRow`, `AIMessageRow`, etc.) live alongside
their interfaces.

## Subdirectories

- **`postgres/`** — Concrete implementations:
  - `client.ts` — Shared `pg.Pool` singleton and schema bootstrap.
  - `vector.ts` — pgvector similarity helpers.
  - `memory-repository.ts` — `PostgresMemoryRepository`.
  - `prompt-repository.ts` — `PostgresUserPromptRepository`.
  - `profile-repository.ts` — `PostgresUserProfileRepository`.
  - `ai-session-repository.ts` — `PostgresAISessionRepository`.
  - `migrations.ts` — Schema migrations.

## Integration Points

- **Consumers** import from `factory.ts` only — never from `postgres/`
  directly.
- `initializeStorage()` is called once at app startup.
- `closeStorage()` is called at graceful shutdown.
- Embedding vectors are produced externally (embedding service) and
  passed in as `Float32Array` — this layer never calls an embedding
  model itself.
