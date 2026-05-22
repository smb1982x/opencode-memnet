# SPEC: Remote PostgreSQL + pgvector Storage Backend

## 1. Summary

Replace the current local SQLite-file persistence and local vector-indexing path with a remote PostgreSQL database using the `pgvector` extension for semantic search.

The target design keeps the existing public plugin behavior stable while moving persistence behind storage repository interfaces. PostgreSQL becomes a first-class storage backend that stores memory rows, user prompts, user profiles, AI sessions, and vector embeddings in one remote database. pgvector replaces both local `usearch` ANN indexes and TypeScript exact-scan vector search for the Postgres path.

The implementation should initially keep the existing SQLite backend as a compatibility and rollback option behind configuration, but the new Postgres backend must not emulate SQLite shard files. The Postgres path uses a single `memories` table with `scope` and `scope_hash` columns plus pgvector HNSW indexes.

## 2. Goals

- Add a remote PostgreSQL storage backend selectable by configuration.
- Use pgvector-native vector columns and HNSW indexes for memory similarity search.
- Preserve current high-level plugin behavior:
  - memory add/search/list/delete,
  - context injection,
  - manual memory tool,
  - auto-capture,
  - user-profile learning,
  - cleanup/deduplication/migration/admin API behavior where applicable.
- Preserve current memory ranking semantics as closely as practical:
  - content embedding weight: `0.6`,
  - tags embedding weight: `0.4`,
  - query-word/tag exact-match boost,
  - similarity threshold filtering.
- Flatten SQLite shard files into a Postgres schema rather than porting shard-per-file semantics.
- Provide a resumable SQLite-to-Postgres migration tool.
- Keep current SQLite implementation operational during rollout unless explicitly removed in a later cleanup phase.
- Avoid logging secrets such as database URLs.

## 3. Non-goals

- Do not replace the embedding provider or embedding cache.
- Do not change the public OpenCode plugin contract.
- Do not change memory content format, tag generation, or profile-learning prompts unless required by storage changes.
- Do not change embedding output dimensions. Per-kind truncation only changes how much input text is sent to the embedding model; vectors remain 1024-dimensional for this rollout.
- Do not implement multi-region replication, read replicas, or hosted database provisioning.
- Do not attempt transparent runtime failover from Postgres to SQLite after partial writes. Backend selection is explicit.
- Do not preserve SQLite application-level sharding in the Postgres schema.

## 4. Current Architecture Constraints

The current repository architecture is documented in `codemap.md` and submaps.

Relevant current modules:

- `src/services/client.ts`
  - `LocalMemoryClient` facade used by plugin hooks, tools, auto-capture, and API handlers.
  - Currently coordinates embedding, shard selection, SQLite connection lookup, and `VectorSearch`.

- `src/services/sqlite/connection-manager.ts`
  - Caches `bun:sqlite` connections by local file path.
  - Applies SQLite PRAGMAs and WAL checkpoint behavior.

- `src/services/sqlite/shard-manager.ts`
  - Maintains `metadata.db` and per-scope/per-hash shard rows.
  - Creates per-shard `.db` files under `CONFIG.storagePath`.
  - Rolls over when `CONFIG.maxVectorsPerShard` is reached.

- `src/services/sqlite/vector-search.ts`
  - Persists `memories` rows and vector BLOBs.
  - Delegates search to the configured vector backend.
  - Merges content-vector and tag-vector results.

- `src/services/vector-backends/*`
  - `USearchBackend` maintains local in-memory ANN indexes.
  - `ExactScanBackend` brute-forces cosine similarity in TypeScript over BLOB vectors.

- `src/services/user-profile/user-profile-manager.ts`
  - Uses SQLite file `user-profiles.db`.

- `src/services/user-prompt/user-prompt-manager.ts`
  - Uses SQLite file `user-prompts.db`.

- `src/services/ai/session/ai-session-manager.ts`
  - Uses SQLite file `ai-sessions.db`.

Important current constraints:

- SQLite calls are synchronous; Postgres calls are async.
- Existing vector storage is `Float32Array` serialized as `BLOB`.
- Current repository default embedding dimension is `CONFIG.embeddingDimensions = 768`, but this target deployment uses a 1024-dimensional embedding model. The Postgres schema and migration validation must use the resolved runtime `CONFIG.embeddingDimensions`, expected to be `1024` for this rollout.
- Existing timestamps are epoch milliseconds stored as integers.
- Existing metadata is stored as serialized JSON text.
- Current all-project search is implemented by searching all project shards.

## 5. Target Architecture

### 5.1 Backend Selection

Add a storage backend configuration concept:

```ts
storageBackend?: "sqlite" | "postgres";
postgres?: {
  url?: string;
  ssl?: boolean | "require";
  maxConnections?: number;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
  vectorType?: "vector" | "halfvec";
  hnswEfSearch?: number;
  hnswEfConstruction?: number;
};
```

Rules:

- Default remains `"sqlite"` for backwards compatibility during rollout.
- `"postgres"` requires a resolved Postgres URL.
- The URL may be supplied through config directly or via the existing secret resolution mechanism.
- Logs must redact credentials and connection strings.
- No silent fallback from Postgres to SQLite after startup. Configuration errors should fail fast with actionable messages.

### 5.2 Repository Boundaries

Introduce storage interfaces so callers stop importing SQLite managers directly.

Recommended new folder:

```text
src/services/storage/
  types.ts
  factory.ts
  sqlite-memory-repository.ts
  postgres/
    client.ts
    migrations.ts
    vector.ts
    memory-repository.ts
    prompt-repository.ts
    profile-repository.ts
    ai-session-repository.ts
```

Core memory repository contract:

```ts
export type StorageBackend = "sqlite" | "postgres";
export type MemoryScopeKind = "user" | "project";

export interface MemorySearchOptions {
  queryVector: Float32Array;
  queryText?: string;
  scope: MemoryScopeKind;
  scopeHash: string;
  containerTag: string;
  includeAllContainers?: boolean;
  limit: number;
  similarityThreshold: number;
}

export interface MemoryRow {
  id: string;
  content: string;
  containerTag: string;
  tags: string[];
  type?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
}

export interface MemoryRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  insert(record: MemoryRecord): Promise<void>;
  delete(memoryId: string): Promise<boolean>;
  update(record: MemoryRecord): Promise<void>;
  getById(memoryId: string): Promise<MemoryRow | null>;

  search(options: MemorySearchOptions): Promise<SearchResult[]>;
  list(args: {
    scope: MemoryScopeKind;
    scopeHash: string;
    containerTag: string;
    includeAllContainers?: boolean;
    limit: number;
  }): Promise<MemoryRow[]>;

  getBySessionId(args: {
    sessionId: string;
    scope: MemoryScopeKind;
    scopeHash: string;
    limit: number;
  }): Promise<SearchResult[]>;

  count(args?: { containerTag?: string; scope?: MemoryScopeKind; scopeHash?: string }): Promise<number>;
  getDistinctTags(args?: { scope?: MemoryScopeKind; scopeHash?: string }): Promise<TagInfo[]>;
  pin(memoryId: string): Promise<void>;
  unpin(memoryId: string): Promise<void>;
}
```

`LocalMemoryClient` must expose `pinMemory()` and `unpinMemory()` or all HTTP/API pinning paths must call the repository directly. Postgres mode must not keep any pin/unpin path that calls `vectorSearch.pinMemory()` or SQLite handles directly.

Non-memory repositories should also be abstracted, because user profiles, prompts, and AI sessions currently use SQLite directly:

- `UserPromptRepository`
- `UserProfileRepository`
- `AISessionRepository`

The existing managers can either become SQLite repository implementations or wrap repository implementations internally.

### 5.3 Client Choice

Use the `postgres` npm package (`postgres.js`) for the Postgres implementation.

Reasons:

- Works well under Bun.
- Includes built-in pooling.
- Ships TypeScript types.
- Tagged-template API encourages parameterized queries.
- Automatic prepared statement handling is suitable for repeated repository queries.

Dependency:

```bash
bun add postgres
```

### 5.4 Postgres Client Lifecycle

`src/services/storage/postgres/client.ts` owns the client singleton.

Expected behavior:

- Lazy-create the client only for the Postgres backend.
- Pool defaults:
  - `max: 10` unless configured otherwise.
  - `idle_timeout: 30` seconds.
  - `connect_timeout: 10` seconds.
  - `ssl: "require"` for remote URLs unless config disables it.
- `initialize()` runs a health check and migrations.
- `close()` calls `sql.end()`.
- All logs redact connection details.

Example shape:

```ts
import postgres from "postgres";

export type SqlClient = postgres.Sql;

export function getPostgresClient(): SqlClient { /* lazy singleton */ }
export async function closePostgresClient(): Promise<void> { /* sql.end() */ }
export async function checkPostgresHealth(): Promise<void> { /* SELECT 1 */ }
```

### 5.5 Per-Kind Embedding Input Lengths

The embedding service should support different maximum input lengths by embedding purpose. This is independent of vector output dimension: this deployment still stores `vector(1024)` or `halfvec(1024)` regardless of the input length.

Add an embedding kind concept:

```ts
export type EmbeddingKind = "content" | "tags" | "query" | "migration";

export interface EmbeddingOptions {
  kind?: EmbeddingKind;
  truncationSide?: "left" | "right";
}
```

Add config:

```ts
embeddingMaxTokens?: {
  content?: number;
  tags?: number;
  query?: number;
  migration?: number;
};
embeddingTruncationSide?: {
  content?: "left" | "right";
  tags?: "left" | "right";
  query?: "left" | "right";
  migration?: "left" | "right";
};
```

Recommended defaults for the 1024-dimensional model with up to 2048 input tokens:

| Kind | Max tokens | Truncation side | Rationale |
|---|---:|---|---|
| `content` | `2048` | `right` | Preserve the beginning of captured memory summaries/code context unless intentionally favoring recency. |
| `migration` | `2048` | `right` | Re-embed full existing memory content as faithfully as possible. |
| `query` | `512` | `right` | User search queries are usually short; keep the beginning if someone pastes a long query. |
| `tags` | `256` | `right` | Tags are short and should not need the full context window. |

vLLM note:

- vLLM supports per-request `truncate_prompt_tokens` for OpenAI-compatible embeddings.
- Native vLLM truncation keeps the **last** `k` tokens, i.e. left-truncates by dropping the beginning.
- vLLM does not natively support right truncation.

Therefore:

- For `truncationSide: "left"`, the remote embedding API path may pass `truncate_prompt_tokens: maxTokens` to vLLM.
- For `truncationSide: "right"`, `opencode-mem` must truncate before sending the request, preserving the first `maxTokens` tokens or a conservative approximation.
- If token-accurate truncation is unavailable, use a conservative app-side character/word truncation fallback and document that it is approximate.
- Cache keys must include the embedding kind, max token setting, truncation side, model, and input text so differently truncated embeddings are not mixed.

Call sites should be updated from:

```ts
embeddingService.embedWithTimeout(text)
```

to:

```ts
embeddingService.embedWithTimeout(content, { kind: "content" });
embeddingService.embedWithTimeout(tags.join(", "), { kind: "tags" });
embeddingService.embedWithTimeout(query, { kind: "query" });
embeddingService.embedWithTimeout(memory.content, { kind: "migration" });
```

## 6. Postgres Schema

### 6.1 Migration Table

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.2 Extension Requirements

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Optionally enable `pgcrypto` if UUID generation is delegated to Postgres. Current code generates text IDs in the application, so `pgcrypto` is not required.

### 6.3 Embedding Configuration Table

Tracks the active embedding model and dimension used by vector columns.

```sql
CREATE TABLE IF NOT EXISTS embedding_config (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_name TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_type TEXT NOT NULL CHECK (vector_type IN ('vector', 'halfvec')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_config_active
ON embedding_config(is_active)
WHERE is_active = TRUE;
```

Activation must be transactional so the partial unique index never sees two active rows:

```sql
BEGIN;
UPDATE embedding_config SET is_active = FALSE WHERE is_active = TRUE;
INSERT INTO embedding_config (model_name, dimensions, vector_type, is_active)
VALUES ($1, $2, $3, TRUE);
COMMIT;
```

### 6.4 Memories Table

Postgres replaces all per-shard SQLite `memories` tables with one table.

The schema should be generated with the configured embedding dimension. This deployment uses a `1024`-dimension embedding model.

Recommended initial vector type: `vector(1024)`.

`halfvec(1024)` may be enabled later or through config, but `vector` preserves current full-precision `Float32Array` semantics and avoids precision drift during the first migration.

```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,

  scope TEXT NOT NULL CHECK (scope IN ('user', 'project')),
  scope_hash TEXT NOT NULL,
  shard_index INTEGER,

  content TEXT NOT NULL,
  vector vector(1024) NOT NULL,
  tags_vector vector(1024),

  container_tag TEXT NOT NULL,
  tags TEXT,
  type TEXT,

  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  session_id TEXT GENERATED ALWAYS AS (COALESCE(metadata->>'sessionID', metadata->>'sessionId', metadata->>'session_id')) STORED,

  display_name TEXT,
  user_name TEXT,
  user_email TEXT,
  project_path TEXT,
  project_name TEXT,
  git_repo_url TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,

  migrated_from_db_path TEXT,
  migrated_at TIMESTAMPTZ
);
```

Notes:

- `scope`, `scope_hash`, and optional `shard_index` preserve enough source identity to support migration auditing and existing scope behavior.
- `shard_index` is not used for runtime query routing in the Postgres path.
- `session_id` is generated from JSONB metadata so session lookup no longer needs `metadata LIKE`. The expression accepts canonical `sessionID` plus likely legacy spellings; migration should still normalize metadata to `sessionID`.
- Keep `tags` as text initially to minimize behavioral drift. A future migration may add `tags_array TEXT[]`.

### 6.5 Memories Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_memories_scope
ON memories(scope, scope_hash);

CREATE INDEX IF NOT EXISTS idx_memories_container_tag
ON memories(container_tag);

CREATE INDEX IF NOT EXISTS idx_memories_type
ON memories(type);

CREATE INDEX IF NOT EXISTS idx_memories_created_at
ON memories(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_is_pinned
ON memories(is_pinned);

CREATE INDEX IF NOT EXISTS idx_memories_session_id
ON memories(session_id)
WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memories_metadata_gin
ON memories USING GIN(metadata);
```

Vector indexes should use HNSW for the Postgres backend:

```sql
CREATE INDEX IF NOT EXISTS idx_memories_vector_hnsw
ON memories USING hnsw (vector vector_cosine_ops)
WITH (m = 16, ef_construction = 256);

CREATE INDEX IF NOT EXISTS idx_memories_tags_vector_hnsw
ON memories USING hnsw (tags_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 256)
WHERE tags_vector IS NOT NULL;
```

`ef_construction` should be configurable via `postgres.hnswEfConstruction`. `256` is the recommended starting point for a 1024-dimensional recall-sensitive memory workload; higher values improve recall at the cost of slower index builds and larger build-time memory use.

Production index creation should support `CONCURRENTLY` when run after data load. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction.

### 6.6 User Prompt Tables

Port `user_prompts` from SQLite:

```sql
CREATE TABLE IF NOT EXISTS user_prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  project_path TEXT,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  captured SMALLINT NOT NULL DEFAULT 0,
  user_learning_captured BOOLEAN NOT NULL DEFAULT FALSE,
  linked_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_prompts_session ON user_prompts(session_id);
CREATE INDEX IF NOT EXISTS idx_user_prompts_captured ON user_prompts(captured);
CREATE INDEX IF NOT EXISTS idx_user_prompts_created ON user_prompts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_prompts_project ON user_prompts(project_path);
CREATE INDEX IF NOT EXISTS idx_user_prompts_linked ON user_prompts(linked_memory_id);
CREATE INDEX IF NOT EXISTS idx_user_prompts_user_learning ON user_prompts(user_learning_captured);
```

`captured` remains `SMALLINT` because current code uses tri-state values:

- `0`: uncaptured,
- `1`: captured,
- `2`: claimed/in progress.

### 6.7 User Profile Tables

```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  profile_data JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  last_analyzed_at BIGINT NOT NULL,
  total_prompts_analyzed INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS user_profile_changelogs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  change_type TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  profile_data_snapshot JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active ON user_profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_user_profile_changelogs_profile_id ON user_profile_changelogs(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_changelogs_version ON user_profile_changelogs(version DESC);
```

### 6.8 AI Session Tables

```sql
CREATE TABLE IF NOT EXISTS ai_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL,
  conversation_id TEXT,
  metadata JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ai_session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_call_id TEXT,
  content_blocks JSONB,
  created_at BIGINT NOT NULL,
  UNIQUE(ai_session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_session_id ON ai_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_expires_at ON ai_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_provider ON ai_sessions(provider);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(ai_session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_ai_messages_role ON ai_messages(ai_session_id, role);
```

Before adding or relying on `UNIQUE(ai_session_id, sequence)` during import, migration must preflight existing SQLite `ai_messages` rows. SQLite currently does not enforce this uniqueness, so duplicate sequences should be reported or deterministically resolved before insertion.

## 7. Vector Serialization

Current SQLite storage:

```ts
new Uint8Array(vector.buffer)
```

Postgres/pgvector storage:

- Convert `Float32Array` to a pgvector literal string: `"[0.1,0.2,...]"`.
- Always cast query and insert parameters to the configured vector type and dimension.

Helpers:

```ts
export function vectorToPgLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

export function assertVectorDimensions(vector: Float32Array, dimensions: number): void {
  if (vector.length !== dimensions) {
    throw new Error(`Expected ${dimensions} dimensions, received ${vector.length}`);
  }
}
```

For dynamic dimensions, SQL must be generated from validated numeric config, not untrusted user input:

```ts
const vectorCast = CONFIG.postgres.vectorType === "halfvec"
  ? `halfvec(${CONFIG.embeddingDimensions})`
  : `vector(${CONFIG.embeddingDimensions})`;
```

## 8. Search Semantics

### 8.1 Scope Filtering

Current behavior:

- Project search uses one project scope hash.
- User search uses one user scope hash.
- All-project search includes all project memories and ignores one specific `container_tag`.

Postgres behavior:

- For project/user scope: filter by `scope` and `scope_hash`.
- For all-project scope: filter by `scope = 'project'` and omit `scope_hash` and `container_tag` filters.

### 8.2 Weighted Vector Search

pgvector cosine distance operator: `<=>`.

Similarity is `1 - distance`.

The Postgres path should preserve:

```ts
similarity = contentSim * 0.6 + finalTagsSim * 0.4;
finalTagsSim = Math.max(tagsSim, exactMatchBoost);
```

Recommended implementation: retrieve a candidate set using indexed vector order, compute weighted score in SQL, then perform exact tag boost in TypeScript for behavioral parity.

Candidate SQL shape:

```sql
WITH candidates AS (
  (
    SELECT id
    FROM memories
    WHERE scope = $2
      AND ($3::text = '' OR scope_hash = $3)
      AND ($4::text = '' OR container_tag = $4)
    ORDER BY vector <=> $1::vector(1024)
    LIMIT $5
  )
  UNION
  (
    SELECT id
    FROM memories
    WHERE scope = $2
      AND ($3::text = '' OR scope_hash = $3)
      AND ($4::text = '' OR container_tag = $4)
      AND tags_vector IS NOT NULL
    ORDER BY tags_vector <=> $1::vector(1024)
    LIMIT $5
  )
)
SELECT
  m.*,
  1 - (m.vector <=> $1::vector(1024)) AS content_sim,
  CASE
    WHEN m.tags_vector IS NULL THEN 0
    ELSE 1 - (m.tags_vector <=> $1::vector(1024))
  END AS tags_sim
FROM memories m
JOIN candidates c ON c.id = m.id;
```

Then TypeScript computes exact-match boost, final similarity, threshold filtering, sort, and limit.

Rationale:

- `ORDER BY vector <=> query LIMIT n` can use the HNSW index.
- Unioning content and tag candidates approximates current two-query behavior.
- Final scoring stays aligned with current code.
- It avoids relying on an expression order like `(0.6 * content + 0.4 * tags)` that may not use a vector index efficiently.
- The `($3 = '' OR scope_hash = $3)` clause preserves current all-project behavior, where an empty scope hash means “all project scopes,” not a literal empty hash.

### 8.3 Thresholds and Limits

Current code searches `limit * 4` per vector kind per shard. Postgres should use a candidate multiplier:

```ts
candidateLimit = Math.max(limit * 4, 50)
```

Then apply `CONFIG.similarityThreshold` after final score computation.

### 8.4 HNSW Query Tuning

Support optional `hnsw.ef_search`:

- default: database default unless configured.
- if configured, set per transaction/query with `SET LOCAL hnsw.ef_search = <value>` inside an explicit transaction.
- recommended value for recall-sensitive use: `128`.

## 9. Migration Requirements

Add a migration command/service that reads current SQLite data and writes Postgres data.

Required behavior:

- Discover all SQLite shards via `metadata.db` and `ShardManager` metadata.
- Read `memories` rows from each shard.
- Decode `vector` and `tags_vector` BLOBs into `Float32Array`.
- Validate vector dimensions against Postgres schema dimension.
- Insert memory rows into Postgres in batches.
- Preserve IDs, content, tags, type, timestamps, metadata, display/user/project/git fields, pinned state, source scope/hash/shard info.
- Migrate user prompts, user profiles, profile changelogs, AI sessions, and AI messages.
- Be idempotent by using primary keys and `ON CONFLICT` behavior.
- Provide `--dry-run` mode.
- Provide count verification.
- Avoid deleting SQLite source data by default.
- Convert `is_pinned` from SQLite integer `0`/`1` to Postgres boolean.
- Validate and report `container_tag` values that cannot be parsed into the expected scope/hash format.
- Normalize metadata session keys during import. The canonical key is `sessionID`; if legacy rows contain `session_id` or `sessionId`, normalize to `sessionID` or make the generated column use `COALESCE`.
- Use controlled batch concurrency so migration does not exhaust the Postgres connection pool.
- Warn users that after switching to Postgres and writing new memories, switching back to SQLite will not include those Postgres-only writes unless a reverse export is implemented.

Recommended command shape:

```text
opencode-mem migrate-to-postgres \
  --storage-path ~/.opencode-mem/data \
  --batch-size 500 \
  --dry-run
```

The migration command should read the Postgres URL from normal config/secret resolution by default. A `--postgres-url` override may exist for scripts, but docs and implementation should treat config as the primary source.

## 10. Compatibility Requirements

- Existing SQLite backend should continue to work while `storageBackend` defaults to `sqlite`.
- Public tool/API result shapes should stay compatible.
- Existing config files without Postgres settings should continue to load.
- `CONFIG.maxVectorsPerShard` and `CONFIG.vectorBackend` remain relevant only for SQLite.
- Postgres backend should ignore `maxVectorsPerShard` and local vector backend selection.

## 11. Operational Requirements

- Startup should validate Postgres connectivity and pgvector availability when `storageBackend = "postgres"`.
- Startup should validate `CONFIG.embeddingDimensions` matches the active Postgres vector column dimension/embedding config.
- Query failures should log actionable messages without leaking secrets.
- Connection pool should close on plugin shutdown.
- Remote DB latency should be controlled through query batching and single-query search paths.
- Admin/status endpoints should expose backend type and health status without exposing credentials.

## 12. Testing Requirements

### Unit Tests

- `vectorToPgLiteral()` and BLOB decode conversion.
- Repository factory selection.
- Config parsing and secret resolution for Postgres settings.
- Search scoring parity function for content/tags/exact-match boost.

### Contract Tests

Shared test suite for `MemoryRepository` implementations:

- insert/get/list/delete.
- project scope search.
- all-project search.
- tags-vector ranking.
- exact tag boost.
- session ID lookup.
- pin/unpin.
- count and distinct tags.

### Postgres Integration Tests

- Run against PostgreSQL with pgvector enabled.
- Apply migrations from a clean database.
- Verify HNSW indexes exist.
- Verify vector search returns expected ordering for deterministic vectors.
- Verify JSONB metadata/session queries.

### Migration Tests

- Fixture SQLite shard set to Postgres.
- Count comparison by table.
- Vector integrity comparison using cosine similarity or exact float comparison before insertion.
- Idempotent rerun.

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Sync-to-async refactor affects many call sites | Introduce repository interfaces first and let TypeScript identify missing awaits. |
| Search ranking drift | Keep final weighted scoring and exact tag boost in TypeScript after pgvector candidate retrieval. Add parity tests. |
| Vector dimension mismatch | Validate at application boundary and startup; store active embedding config in Postgres. |
| Remote DB unavailable | Fail fast for Postgres backend; keep SQLite as config-selectable compatibility backend. |
| Connection string leakage | Redact URLs in logs and errors. Use secret resolver. |
| HNSW index build locks/slowdowns | Use `CREATE INDEX CONCURRENTLY` for production post-load builds; build after bulk migration. |
| JSON metadata imported incorrectly as string | Parse SQLite metadata text into JSON before inserting JSONB. Validate `jsonb_typeof(metadata) = 'object'`. |
| Postgres path accidentally uses SQLite shard assumptions | Make Postgres repository use `scope`/`scope_hash`, not `ShardInfo.dbPath`, for runtime routing. |
| Bun TLS differences with remote Postgres | Test against the target provider early; document CA/SNI troubleshooting and use proper CA configuration rather than logging or disabling TLS silently. |
| AI message duplicate sequences block migration | Preflight duplicate `(ai_session_id, sequence)` rows before adding/enforcing the unique constraint, or resolve conflicts during import. |
| PG-only foreign key behavior differs from SQLite | Document that deleting memories in Postgres can null `user_prompts.linked_memory_id`; update tests to expect backend-specific cleanup semantics. |

## 14. Acceptance Criteria

- `storageBackend: "postgres"` runs without using SQLite memory shard files for memory CRUD/search.
- pgvector extension and required tables/indexes are created by migrations.
- `memoryClient.addMemory`, `searchMemories`, `listMemories`, `deleteMemory`, and `searchMemoriesBySessionID` work with Postgres.
- Auto-capture and user-profile learning work against Postgres-backed repositories.
- User prompts, user profiles, and AI sessions are persisted in Postgres when selected.
- SQLite remains usable when selected by config.
- Migration tool can move existing SQLite data to Postgres and verify counts.
- Typecheck passes.
- Existing SQLite tests pass or are updated to the repository interface.
- Postgres integration tests pass in an environment with pgvector.
