# Postgres Storage Backend (`src/services/storage/postgres/`)

## Responsibility

Pgvector-backed storage implementing all repository interfaces defined in `../types.ts`.
Each repository class calls `runPostgresMigrations()` in `initialize()` and `closePostgresClient()` in `close()`.

## Client & Pool (`client.ts`)

Lazy singleton `getPostgresClient()` wrapping the `postgres.js` connection pool.
Config-driven pool size, timeouts, SSL (`"require"` by default).
`checkPostgresHealth()` issues `SELECT 1`; all logs redact credentials via `redactDatabaseUrl`.

## Vector Utilities (`vector.ts`)

Pure functions — no DB access, fully unit-testable:

- `vectorToPgLiteral()` — Float32Array → `[0.1,0.2,…]` string for pgvector.
- `assertVectorDimensions()` — runtime dimension guard.
- `decodeSqliteVectorBlob()` — rehydrates SQLite blobs to Float32Array (migration use).
- `getVectorCast()` — returns validated `"vector(N)"` or `"halfvec(N)"` type string.
- `redactDatabaseUrl()` — masks password for safe logging.

## Migration System (`migrations.ts`)

Numbered `Migration[]` array (versions 1–10). Runner ensures `schema_migrations` table,
skips already-applied versions, and runs pending ones.
Transactional migrations wrap in `sql.begin()`; non-transactional (e.g. HNSW index build) run directly.
Key DDL: `pgvector` extension, `embedding_config`, `memories` (with dynamic vector columns),
`user_prompts`, `user_profiles` + `user_profile_changelogs`, `ai_sessions` + `ai_messages`.

## Memory Repository (`memory-repository.ts`)

Core search uses the **candidate-union strategy**:

1. Two parallel HNSW nearest-neighbor sub-queries (content vector + tags vector) via `UNION`.
2. Candidates re-joined to `memories` for full-row fetch with both similarity scores.
3. **Weighted scoring**: `contentSim × 0.6 + max(tagsSim, exactMatchBoost) × 0.4`.
4. Results sorted by score, filtered by threshold, trimmed to limit.

Supports optional `SET LOCAL hnsw.ef_search` per-query for tuning recall vs. latency.
HNSW indexes use cosine ops (`vector_cosine_ops` / `halfvec_cosine_ops`), `m=16`, configurable `ef_construction`.

## Prompt Repository (`prompt-repository.ts`)

Tri-state capture flag: 0=uncaptured → 1=captured → 2=claimed.
`claimPrompt()` uses `UPDATE … WHERE captured = 0 RETURNING id` for atomic handoff.
Separate `user_learning_captured` boolean tracks the user-learning pipeline.
`deleteOldPrompts()` collects linked memory IDs before bulk delete.

## Profile Repository (`profile-repository.ts`)

JSONB-backed profile storage with versioned changelogs.
`mergeProfileData()` implements upsert-by-description dedup for preferences, patterns, and workflows,
with confidence boosting (+0.1 on re-observation) and cap enforcement via CONFIG limits.
`applyConfidenceDecay()` ages out low-confidence preferences; changelogs pruned to retention count.

## AI Session Repository (`ai-session-repository.ts`)

TTL-based session expiry (`expires_at` column, `cleanupExpiredSessions()`).
Messages ordered by `sequence` with a UNIQUE constraint on `(ai_session_id, sequence)`.
JSONB columns for metadata, tool_calls, and content_blocks.
`getLastSequence()` returns -1 for empty sessions (no rows).
