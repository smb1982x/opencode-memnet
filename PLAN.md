# PLAN: Replace Local SQLite + Local Vector Indexing with PostgreSQL + pgvector

## 1. Implementation Strategy

Implement this as a staged backend migration, not a direct one-shot rewrite.

The safest path is:

1. Extract storage interfaces while keeping SQLite behavior unchanged.
2. Add Postgres client and migrations.
3. Implement Postgres repositories behind the same interfaces.
4. Wire backend selection through config.
5. Add migration tooling from SQLite to Postgres.
6. Update tests and docs.
7. Optionally remove SQLite/local vector code in a later major version.

This avoids breaking existing users and lets the TypeScript compiler guide the sync-to-async conversion.

## 2. Work Breakdown

### Phase 0 — Preparation and Baseline

Estimated effort: 0.5 day

#### Tasks

- Read `codemap.md` and relevant submaps before editing:
  - `src/services/codemap.md`
  - `src/services/sqlite/codemap.md`
  - `src/services/vector-backends/codemap.md`
  - `src/services/user-prompt/codemap.md`
  - `src/services/user-profile/codemap.md`
  - `src/services/ai/session/codemap.md`
- Run current validation:
  - `bun run typecheck`
  - current test command if available in repo/tooling.
- Record current behavior for memory search and scoring from:
  - `src/services/client.ts`
  - `src/services/sqlite/vector-search.ts`
  - `src/services/api-handlers.ts`
- Identify all direct SQLite imports.

#### Expected direct SQLite consumers to eliminate or wrap

- `src/services/client.ts`
- `src/services/api-handlers.ts`
- `src/services/cleanup-service.ts`
- `src/services/deduplication-service.ts`
- `src/services/migration-service.ts`
- `src/services/user-prompt/user-prompt-manager.ts`
- `src/services/user-profile/user-profile-manager.ts`
- `src/services/ai/session/ai-session-manager.ts`
- `src/index.ts` shutdown dynamic import.

#### Deliverables

- Baseline test/typecheck result.
- Notes for any existing failing tests before migration work.

---

### Phase 1 — Add Config and Storage Interfaces

Estimated effort: 1.5–2.5 days

#### 1.1 Add config keys

File: `src/config.ts`

Add config shape:

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

Defaults:

```ts
storageBackend: "sqlite",
postgres: {
  ssl: "require",
  maxConnections: 10,
  idleTimeoutSeconds: 30,
  connectTimeoutSeconds: 10,
  vectorType: "vector",
  hnswEfConstruction: 256,
},
embeddingMaxTokens: {
  content: 2048,
  tags: 256,
  query: 512,
  migration: 2048,
},
embeddingTruncationSide: {
  content: "right",
  tags: "right",
  query: "right",
  migration: "right",
}
```

Requirements:

- Use `resolveSecretValue()` for `postgres.url`.
- Update config template comments.
- Validate `postgres.url` exists when backend is `postgres`.
- Do not log the full URL.
- Document that embedding max tokens affect input length only; embedding output dimension remains 1024 for this rollout.

#### 1.1a Add per-kind embedding truncation support

File: `src/services/embedding.ts`

Add types:

```ts
type EmbeddingKind = "content" | "tags" | "query" | "migration";

interface EmbeddingOptions {
  kind?: EmbeddingKind;
  truncationSide?: "left" | "right";
}
```

Update signatures:

```ts
embed(text: string, options?: EmbeddingOptions): Promise<Float32Array>
embedWithTimeout(text: string, options?: EmbeddingOptions): Promise<Float32Array>
```

Implement truncation rules:

- Resolve `maxTokens` from `CONFIG.embeddingMaxTokens[kind]`.
- Resolve side from `options.truncationSide ?? CONFIG.embeddingTruncationSide[kind]`.
- For remote vLLM/OpenAI-compatible embeddings:
  - if side is `"left"`, pass per-request `truncate_prompt_tokens: maxTokens` because vLLM natively keeps the last `k` tokens;
  - if side is `"right"`, truncate in app before request because vLLM does not natively keep the first `k` tokens.
- For local `@xenova/transformers`, apply app-side truncation before `this.pipe(...)`.
- Prefer token-aware truncation if a tokenizer is readily available; otherwise start with a conservative approximate truncation helper and document approximation.
- Include `kind`, `maxTokens`, `truncationSide`, and model in the embedding cache key. The current cache key is only raw text and would mix embeddings produced with different truncation options.

Update embedding call sites:

- `src/services/client.ts`
  - query: `{ kind: "query" }`
  - content: `{ kind: "content" }`
  - tags: `{ kind: "tags" }`
- `src/services/api-handlers.ts`
  - same mapping as client paths.
- `src/services/migration-service.ts`
  - memory content re-embedding: `{ kind: "migration" }`

Validation:

- Unit-test config resolution for per-kind max tokens.
- Unit-test remote request body includes `truncate_prompt_tokens` only for left truncation.
- Unit-test right truncation happens before request.
- Unit-test cache differentiates same text embedded with different kinds/options.

#### 1.2 Add storage type contracts

Create:

```text
src/services/storage/types.ts
src/services/storage/factory.ts
```

Define:

- `StorageBackend`
- `MemoryRepository`
- `UserPromptRepository`
- `UserProfileRepository`
- `AISessionRepository`
- shared DB row/domain mapping types as needed.

Keep interfaces close to current manager behavior. Do not over-generalize.

#### 1.3 Wrap current SQLite memory behavior

Create:

```text
src/services/storage/sqlite-memory-repository.ts
```

This wrapper should internally use current:

- `shardManager`
- `connectionManager`
- `vectorSearch`

It should expose async methods even if underlying SQLite operations are synchronous.

Example:

```ts
async insert(record: MemoryRecord): Promise<void> {
  const { scope, hash } = extractScopeFromContainerTag(record.containerTag);
  const shard = shardManager.getWriteShard(scope, hash);
  const db = connectionManager.getConnection(shard.dbPath);
  await vectorSearch.insertVector(db, record, shard);
  shardManager.incrementVectorCount(shard.id);
}
```

#### 1.4 Update `LocalMemoryClient` to depend on repository

File: `src/services/client.ts`

Change `LocalMemoryClient` from direct SQLite orchestration to repository orchestration.

Expected changes:

- Constructor accepts optional `MemoryRepository`.
- Default repository comes from `createMemoryRepository(CONFIG)`.
- `close()` becomes async or delegates to async repository close.
- `searchMemories`, `addMemory`, `deleteMemory`, `listMemories`, `searchMemoriesBySessionID` preserve external return shapes.
- Add `pinMemory` and `unpinMemory` passthrough methods, or route all pin/unpin HTTP handlers directly through the repository. No pin/unpin path should keep using `vectorSearch.pinMemory()` in Postgres mode.

#### 1.5 Keep public API stable

Do not change callers yet unless TypeScript requires `await memoryClient.close()`. If `close()` becomes async, update shutdown callers to await it and handle rejections so Postgres pool shutdown failures are not silently dropped.

#### Validation

- `bun run typecheck`
- Existing SQLite-focused tests should still pass.
- Manual smoke path:
  - add memory,
  - search memory,
  - list memory,
  - delete memory.

#### Exit criteria

- SQLite behavior is unchanged from user perspective.
- Most direct SQLite usage from `client.ts` is moved behind repository.

---

### Phase 2 — Abstract Prompts, Profiles, and AI Sessions

Estimated effort: 2–3 days

The Postgres migration is not complete if only memories move. Current prompt/profile/session managers also write SQLite files through `connectionManager`.

#### 2.1 User prompts

Files:

- `src/services/user-prompt/user-prompt-manager.ts`
- new `src/services/storage/sqlite-user-prompt-repository.ts`

Approach:

- Extract the current SQLite SQL into a SQLite repository, or make `UserPromptManager` delegate to a `UserPromptRepository`.
- Keep existing singleton export behavior for callers.
- Convert public methods to async if they touch the repository.

High-impact callers:

- `src/index.ts`
- `src/services/auto-capture.ts`
- `src/services/user-memory-learning.ts`
- `src/services/cleanup-service.ts`
- `src/services/api-handlers.ts`

#### 2.2 User profiles

Files:

- `src/services/user-profile/user-profile-manager.ts`
- `src/services/user-profile/profile-context.ts`
- new SQLite repository wrapper.

Approach:

- Repository handles profile CRUD and changelog CRUD.
- Manager handles safe normalization and business logic if not moved.
- Convert JSON text handling behind row mappers.

High-impact callers:

- `src/services/user-memory-learning.ts`
- `src/services/context.ts`
- `src/services/api-handlers.ts`

#### 2.3 AI sessions

Files:

- `src/services/ai/session/ai-session-manager.ts`
- `src/services/ai/ai-provider-factory.ts`
- `src/services/ai/providers/*.ts`

Approach:

- Extract `AISessionRepository` for sessions/messages.
- `AISessionManager` delegates to repository.
- Keep provider constructor API stable if possible.
- Convert metadata/tool call/content blocks mapping behind repository.

#### Validation

- `bun run typecheck`
- Unit or integration tests for prompt claim tri-state:
  - `captured = 0 -> 2 -> 1`.
- Profile create/update/changelog test.
- AI session create, add messages, replay order, expiry cleanup.

#### Exit criteria

- SQLite prompt/profile/session storage is behind interfaces.
- Callers are async-safe.

---

### Phase 3 — Add Postgres Client and Schema Migrations

Estimated effort: 2–3 days

#### 3.1 Add dependency

```bash
bun add postgres
```

#### 3.2 Add Postgres client module

Create:

```text
src/services/storage/postgres/client.ts
```

Responsibilities:

- Create singleton `postgres` client from resolved config.
- Health check with `SELECT 1`.
- Apply redaction to connection errors/logs.
- Close pool on shutdown.

#### 3.3 Add migration runner

Create:

```text
src/services/storage/postgres/migrations.ts
```

Responsibilities:

- Ensure `schema_migrations` exists.
- Run numbered SQL migrations in order.
- Ensure `CREATE EXTENSION IF NOT EXISTS vector` is first.
- Create schema from `SPEC.md`.
- Insert/update active `embedding_config`.
- Validate current active embedding dimension.

Implementation note:

- For `CREATE INDEX CONCURRENTLY`, migration runner must support non-transactional migrations.
- Initial clean DB migrations can run ordinary `CREATE INDEX IF NOT EXISTS`.
- Bulk import can optionally defer vector indexes until after data load.

#### 3.4 Dynamic vector dimension SQL

Because `vector(1024)` for this deployment depends on config, create SQL using validated numeric config.

Rules:

- Only accept positive integer dimensions.
- For `vector`, dimension must be `<= 2000`.
- For `halfvec`, dimension must be `<= 4000`.
- Do not interpolate arbitrary strings.
- Validate the resolved runtime dimension before schema creation. For this rollout, the expected dimension is `1024`, even though the repository's historical default config is `768`.

#### 3.5 HNSW tuning defaults

- Use `m = 16`.
- Use `ef_construction = 256` by default for 1024-dimensional vectors.
- Expose `postgres.hnswEfConstruction` so high-recall deployments can increase it.
- Expose `postgres.hnswEfSearch` for query-time recall tuning.

#### Validation

- Integration smoke with local Postgres + pgvector:
  - run migrations,
  - verify tables exist,
  - verify vector extension exists,
  - verify indexes exist.
- `bun run typecheck`.

#### Exit criteria

- `storageBackend: "postgres"` can connect and initialize an empty schema.

---

### Phase 4 — Implement Postgres Memory Repository

Estimated effort: 3–5 days

#### 4.1 Add vector helpers

Create:

```text
src/services/storage/postgres/vector.ts
```

Functions:

- `vectorToPgLiteral(vector: Float32Array): string`
- `assertVectorDimensions(vector, dimensions): void`
- `decodeSqliteVectorBlob(blob): Float32Array`
- `getVectorCast(config): "vector(N)" | "halfvec(N)"`
- maybe `redactDatabaseUrl(url): string`

#### 4.2 Add repository

Create:

```text
src/services/storage/postgres/memory-repository.ts
```

Implement all `MemoryRepository` methods.

##### Insert

- Validate dimensions for `record.vector` and optional `record.tagsVector`.
- Parse `record.metadata` string into JSON object.
- Derive `scope` and `scope_hash` from `record.containerTag` using existing scope helper logic.
- Insert with `ON CONFLICT (id) DO UPDATE` only if update semantics are desired; otherwise use plain insert and surface duplicate errors.
- Store `is_pinned` as boolean.

##### Delete

- `DELETE FROM memories WHERE id = $id RETURNING id`.
- Return boolean.

##### Get by ID

- Select by `id`.
- Map snake_case DB row back to current row/result shape.

##### List

- For scoped search, filter by `scope`, `scope_hash`, and `container_tag` unless `includeAllContainers` is true.
- Order by `created_at DESC`.

##### Search

Use candidate-union strategy:

1. candidate content search ordered by `vector <=> query`.
2. candidate tags search ordered by `tags_vector <=> query`.
3. hydrate unioned candidates.
4. compute final score in TypeScript using current formula.
5. threshold, sort, limit.

Important:

- Use `candidateLimit = Math.max(limit * 4, 50)`.
- For all-project scope, filter only `scope = 'project'`.
- Use casts matching configured vector type/dimension.
- Optional: wrap query in transaction with `SET LOCAL hnsw.ef_search = configuredValue`.
- `SET LOCAL hnsw.ef_search` only applies inside an explicit transaction; with `postgres.js`, use `sql.begin()` around the setting and search query.

##### Session ID lookup

- Use generated `session_id` column or `metadata->>'sessionID'`.
- Order by `created_at DESC`.

##### Distinct tags

- Replicate current `getDistinctTags()` output shape from `vectorSearch`.

#### 4.3 Wire factory

File: `src/services/storage/factory.ts`

When `CONFIG.storageBackend === "postgres"`:

- create Postgres client,
- run migrations,
- return `PostgresMemoryRepository`.

When `sqlite`:

- return `SqliteMemoryRepository`.

#### 4.4 Update services still using shardManager directly

The following should shift to repository methods:

- `src/services/cleanup-service.ts`
  - needs list/query stale memories and delete.
- `src/services/deduplication-service.ts`
  - needs all memories and delete duplicates.
- `src/services/migration-service.ts`
  - should either become SQLite embedding-migration-only or be split from SQLite-to-Postgres migration.
- `src/services/api-handlers.ts`
  - should avoid direct `shardManager`/`connectionManager`/`vectorSearch` for memory CRUD/search/tag/stats paths.

#### Validation

- `bun run typecheck`
- Postgres integration tests for:
  - insert/get,
  - search by content,
  - tags-vector search,
  - exact tag boost,
  - all-project search,
  - list ordering,
  - session lookup,
  - pin/unpin,
  - delete.

#### Exit criteria

- `LocalMemoryClient` works with Postgres for all core memory operations.
- No Postgres memory operation uses local shard files.

---

### Phase 5 — Implement Postgres Prompt/Profile/Session Repositories

Estimated effort: 2–4 days

#### 5.1 Prompt repository

Create:

```text
src/services/storage/postgres/prompt-repository.ts
```

Implement current `UserPromptManager` behavior:

- `savePrompt`
- `getLastUncapturedPrompt`
- `deletePrompt`
- `markAsCaptured`
- `claimPrompt`
- `countUncaptured`
- `getUncapturedPrompts`
- `markMultipleAsCaptured`
- `countUnanalyzedForUserLearning`
- `getPromptsForUserLearning`
- `markAsUserLearningCaptured`
- `cleanupOldPrompts`
- `linkMemoryToPrompt`
- `getPromptById`
- API search/list methods.

Use `UPDATE ... WHERE captured = 0 RETURNING id` for atomic claim.

#### 5.2 Profile repository

Create:

```text
src/services/storage/postgres/profile-repository.ts
```

Implement profile CRUD and changelog behavior. Use JSONB for `profile_data` and snapshots.

#### 5.3 AI session repository

Create:

```text
src/services/storage/postgres/ai-session-repository.ts
```

Implement:

- session lookup/create/update/delete,
- ordered message read/write,
- sequence allocation,
- expiry cleanup.

Consider transaction for `getLastSequence + insert` to avoid duplicate sequence under concurrent provider calls:

- Either rely on single process serialized usage,
- or use `SELECT ... FOR UPDATE` / unique constraint retry.

Before enforcing `UNIQUE(ai_session_id, sequence)` in Postgres migrations, the SQLite-to-Postgres importer must preflight existing SQLite data for duplicate sequences and either report them or resolve them deterministically.

#### Validation

- Contract tests for each repository.
- Existing auto-capture and user-profile learning tests updated to async repository calls.
- Provider/session tests pass with SQLite and Postgres where feasible.

#### Exit criteria

- With `storageBackend: "postgres"`, all persistent plugin subsystems use Postgres.

---

### Phase 6 — SQLite-to-Postgres Migration Tool

Estimated effort: 2–4 days

#### 6.1 Create migration module

Create:

```text
src/services/storage/postgres/sqlite-importer.ts
```

Responsibilities:

- Discover SQLite source DBs under `CONFIG.storagePath`.
- Read `metadata.db` `shards` table.
- Read each shard's `memories` table.
- Decode vector BLOBs.
- Insert into Postgres in batches.
- Migrate standalone SQLite DBs:
  - `user-prompts.db`,
  - `user-profiles.db`,
  - `ai-sessions.db`.
- Verify counts.

#### 6.2 Add command/API entry point

Options:

- CLI through package binary if this package has/gets one.
- HTTP admin API action through existing web/API layer.
- Internal script under `scripts/`.

Recommended command:

```text
bun run migrate:postgres -- --dry-run --batch-size 500
```

The command should read the Postgres URL from normal `opencode-mem` config and secret resolution. A `--postgres-url` override may be added for scripting, but config is the primary documented source.

If adding package binary, document command:

```text
opencode-mem migrate-to-postgres --dry-run --batch-size 500
```

#### 6.3 Migration algorithm

1. Initialize Postgres schema.
2. Read SQLite shard metadata.
3. For each shard:
   - open connection through current `ConnectionManager` or direct `bun:sqlite`,
   - select all `memories`,
   - decode vectors,
   - parse metadata JSON,
   - convert `is_pinned` integer values to booleans,
   - normalize metadata session keys to canonical `sessionID`,
   - validate/report unparseable `container_tag` values,
   - derive `scope`, `scope_hash`, `shard_index`,
   - batch insert.
4. Migrate user prompts.
5. Migrate user profiles and changelogs.
6. Migrate AI sessions and messages.
7. Report counts and failures.
8. Write migration summary.

#### 6.4 Idempotency

- Memories: `ON CONFLICT (id) DO UPDATE` or `DO NOTHING` with `--overwrite` option.
- Prompts/profiles/sessions: same by primary key.
- Changelogs/messages: primary-key or natural-key conflict handling.
- Default should be `DO NOTHING`; `--overwrite` should be explicit because users may write new Postgres memories after cutover and later rerun migration from stale SQLite files.

#### 6.5 Verification

Report:

- source shard count,
- source memory count,
- imported memory count,
- skipped existing count,
- failed row count,
- prompt/profile/session row counts,
- sample search comparison if not dry-run.

Migration should use controlled concurrency rather than unbounded `Promise.all` over shards/batches, so it cannot exhaust the Postgres connection pool.

#### Validation

- Fixture migration test with multiple shards.
- Rerun migration to prove idempotency.
- Corrupt/missing shard handling test.
- Dimension mismatch test.

#### Exit criteria

- Existing local data can be imported to Postgres without deleting source SQLite files.

---

### Phase 7 — Tests, Tooling, and CI

Estimated effort: 2–4 days

#### 7.1 Shared repository contract tests

Create reusable test suites:

```text
tests/storage/memory-repository.contract.ts
tests/storage/user-prompt-repository.contract.ts
tests/storage/user-profile-repository.contract.ts
tests/storage/ai-session-repository.contract.ts
```

Run each contract against:

- SQLite implementation,
- Postgres implementation when Postgres test URL is configured.

#### 7.2 Postgres test environment

Options:

- Testcontainers with PostgreSQL + pgvector image.
- Docker Compose service.
- Environment-provided `OPENCODE_MEM_TEST_DATABASE_URL`.

Given Bun compatibility, start with environment-provided URL or Docker Compose for simplicity.

Required test DB capabilities:

- PostgreSQL 16+ recommended.
- pgvector extension installed.

#### 7.3 Update vector backend tests

Current tests for `USearchBackend` and `ExactScanBackend` remain SQLite-backend-specific.

Add Postgres-specific tests instead of forcing pgvector into old `VectorBackend` tests.

Potential changes:

- Keep old tests for SQLite mode.
- Add `postgres-memory-repository.test.ts`.
- Add migration tests.

#### 7.4 Performance smoke tests

Optional but useful:

- Insert 10k deterministic vectors.
- Compare search latency.
- Verify query plan uses HNSW index where expected.

#### Validation

- `bun run typecheck`
- SQLite test suite.
- Postgres integration tests when DB configured.
- Migration tests.

#### Exit criteria

- CI has a clear path to run both SQLite-only and Postgres-enabled jobs.

---

### Phase 8 — Documentation and Rollout

Estimated effort: 1–2 days

#### 8.1 Documentation updates

Update:

- README or project docs.
- Config template in `src/config.ts`.
- Codemap after implementation.
- Migration instructions.
- Troubleshooting guide.

Document:

- Postgres setup requirements.
- pgvector extension requirement.
- Example config.
- Migration command.
- Backup recommendation.
- Rollback process.

Example config:

```jsonc
{
  "storageBackend": "postgres",
  "postgres": {
    "url": "$OPENCODE_MEM_DATABASE_URL",
    "ssl": "require",
    "maxConnections": 10,
    "vectorType": "vector",
    "hnswEfSearch": 128,
    "hnswEfConstruction": 256
  }
}
```

#### 8.2 Rollout recommendation

1. Ship as opt-in backend.
2. Keep SQLite default for at least one release.
3. Encourage users to run dry-run migration first.
4. Keep SQLite files as backup.
5. After telemetry/user feedback, decide whether Postgres becomes default or remains optional.

#### Exit criteria

- Users can configure Postgres, initialize schema, migrate data, and roll back to SQLite by changing config.

---

## 3. File-Level Change Map

### New files

Likely new files:

```text
src/services/storage/types.ts
src/services/storage/factory.ts
src/services/storage/sqlite-memory-repository.ts
src/services/storage/sqlite-user-prompt-repository.ts
src/services/storage/sqlite-user-profile-repository.ts
src/services/storage/sqlite-ai-session-repository.ts
src/services/storage/postgres/client.ts
src/services/storage/postgres/migrations.ts
src/services/storage/postgres/vector.ts
src/services/storage/postgres/memory-repository.ts
src/services/storage/postgres/prompt-repository.ts
src/services/storage/postgres/profile-repository.ts
src/services/storage/postgres/ai-session-repository.ts
src/services/storage/postgres/sqlite-importer.ts
```

Potential test files:

```text
tests/storage/memory-repository.contract.ts
tests/storage/postgres-memory-repository.test.ts
tests/storage/postgres-migrations.test.ts
tests/storage/sqlite-to-postgres-migration.test.ts
tests/storage/postgres-vector-utils.test.ts
```

### Modified files

Likely modified files:

```text
package.json
src/config.ts
src/services/client.ts
src/services/api-handlers.ts
src/services/cleanup-service.ts
src/services/deduplication-service.ts
src/services/migration-service.ts
src/services/user-prompt/user-prompt-manager.ts
src/services/user-profile/user-profile-manager.ts
src/services/user-profile/profile-context.ts
src/services/ai/session/ai-session-manager.ts
src/services/ai/ai-provider-factory.ts
src/services/ai/providers/*.ts
src/index.ts
```

### Files that should stay mostly unchanged

```text
src/services/embedding.ts
src/services/tags.ts
src/services/privacy.ts
src/services/language-detector.ts
src/services/ai/tools/tool-schema.ts
src/services/ai/validators/user-profile-validator.ts
```

---

## 4. Query and Implementation Notes

### 4.1 pgvector cast handling

The query vector should be bound as a parameter and cast:

```sql
$1::vector(1024)
```

or:

```sql
$1::halfvec(1024)
```

Do not concatenate user-provided vector strings into SQL. Generate only the type/dimension cast from validated config.

### 4.2 Search candidate query

Use two HNSW-index-friendly subqueries and union IDs:

```sql
WITH candidates AS (
  (
    SELECT id
    FROM memories
    WHERE scope = $2 AND ($3::text = '' OR scope_hash = $3) AND ($4::text = '' OR container_tag = $4)
    ORDER BY vector <=> $1::vector(1024)
    LIMIT $5
  )
  UNION
  (
    SELECT id
    FROM memories
    WHERE scope = $2 AND ($3::text = '' OR scope_hash = $3) AND ($4::text = '' OR container_tag = $4) AND tags_vector IS NOT NULL
    ORDER BY tags_vector <=> $1::vector(1024)
    LIMIT $5
  )
)
SELECT m.*, 1 - (m.vector <=> $1::vector(1024)) AS content_sim,
       CASE WHEN m.tags_vector IS NULL THEN 0 ELSE 1 - (m.tags_vector <=> $1::vector(1024)) END AS tags_sim
FROM memories m
JOIN candidates c ON c.id = m.id;
```

For all-project search, pass an empty scope hash and container tag or dynamically omit those clauses. The SQL must treat an empty scope hash as “all project scopes,” not as a literal empty hash.

### 4.3 Atomic prompt claim in Postgres

Replace current SQLite update/check with:

```sql
UPDATE user_prompts
SET captured = 2
WHERE id = $1 AND captured = 0
RETURNING id;
```

### 4.4 AI message sequencing

Current sequence is `getLastSequence() + 1`. In Postgres, either:

- keep this with single-process assumptions and unique constraint retry,
- or use transaction/lock for sequence allocation.

Safer implementation:

```sql
BEGIN;
SELECT id FROM ai_sessions WHERE id = $1 FOR UPDATE;
SELECT COALESCE(MAX(sequence), -1) + 1 FROM ai_messages WHERE ai_session_id = $1;
INSERT INTO ai_messages (... sequence ...);
COMMIT;
```

---

## 5. Rollback Strategy

### During opt-in rollout

- SQLite remains the default backend.
- Migration does not delete SQLite source files.
- A user can switch back to SQLite by changing:

```jsonc
{
  "storageBackend": "sqlite"
}
```

### After Postgres writes have occurred

Rollback to SQLite will not automatically include new Postgres-only writes unless an export-back-to-SQLite tool is implemented.

Document this clearly:

- Before switching back, export Postgres data or accept divergent histories.
- The initial migration is one-way for MVP.
- Rerunning SQLite-to-Postgres migration after writing to both backends can create ID/content conflicts; default conflict mode should skip existing Postgres rows unless `--overwrite` is explicitly provided.

### Deployment rollback

- Keep old package version available.
- Keep SQLite data untouched.
- Keep Postgres schema migrations additive where possible.

---

## 6. Open Questions

Resolve before implementation or during Phase 1.

1. Should `storageBackend: "postgres"` move **all** persistence to Postgres immediately, or only memories first?
   - Recommendation: all persistence, because prompts/profiles/sessions also use SQLite and remote DB intent implies no local DB dependency.

2. Should the initial vector type be `vector` or `halfvec`?
   - Recommendation: `vector` for first release to preserve full-precision behavior. Add `halfvec` as opt-in after parity is proven.

3. Should migration overwrite conflicting IDs?
   - Recommendation: default `DO NOTHING`; add `--overwrite` for explicit replacement.

4. Should Postgres become the default eventually?
   - Recommendation: not until at least one opt-in release validates migration and operations.

5. Should existing `migration-service.ts` be renamed?
   - Recommendation: yes eventually. Current service handles embedding model/dimension migration inside SQLite. New SQLite-to-Postgres migration should be separate to avoid ambiguity.

6. Should Postgres enforce `user_prompts.linked_memory_id REFERENCES memories(id) ON DELETE SET NULL`?
   - Recommendation: yes for data integrity, but document the behavior difference from SQLite and update tests accordingly.

---

## 7. Milestone Checklist

### M1 — Storage interfaces with SQLite parity

- [ ] Config keys added.
- [ ] Repository interfaces added.
- [ ] SQLite memory repository wraps current behavior.
- [ ] `LocalMemoryClient` uses repository.
- [ ] Typecheck passes.
- [ ] Existing SQLite behavior verified.

### M2 — Non-memory repositories abstracted

- [ ] User prompt repository interface and SQLite implementation.
- [ ] User profile repository interface and SQLite implementation.
- [ ] AI session repository interface and SQLite implementation.
- [ ] Callers updated for async methods.
- [ ] Typecheck/tests pass.

### M3 — Postgres schema/client

- [ ] `postgres` dependency added.
- [ ] Postgres client module added.
- [ ] Migration runner added.
- [ ] pgvector extension migration added.
- [ ] Tables/indexes created.
- [ ] Empty DB initializes successfully.

### M4 — Postgres memory backend

- [ ] Vector helpers added.
- [ ] Postgres memory repository implemented.
- [ ] Search parity tests added.
- [ ] `LocalMemoryClient` works with Postgres.
- [ ] API memory routes work with Postgres.

### M5 — Postgres full persistence

- [ ] Postgres prompt repository implemented.
- [ ] Postgres profile repository implemented.
- [ ] Postgres AI session repository implemented.
- [ ] Auto-capture works.
- [ ] User-profile learning works.
- [ ] AI provider sessions work.

### M6 — Migration tooling

- [ ] SQLite shard discovery implemented.
- [ ] Memory import implemented.
- [ ] Prompt/profile/session import implemented.
- [ ] Dry-run mode implemented.
- [ ] Idempotent rerun implemented.
- [ ] Count verification implemented.

### M7 — Release readiness

- [ ] Docs updated.
- [ ] Example config documented.
- [ ] Troubleshooting documented.
- [ ] CI/test instructions documented.
- [ ] Codemaps updated after implementation.

---

## 8. Effort Estimate

| Phase | Estimate |
|---|---:|
| Phase 0 — Preparation | 0.5 day |
| Phase 1 — Config/interfaces/SQLite memory wrapper | 1.5–2.5 days |
| Phase 2 — Prompt/profile/session abstraction | 2–3 days |
| Phase 3 — Postgres client/schema | 2–3 days |
| Phase 4 — Postgres memory repository/search | 3–5 days |
| Phase 5 — Postgres prompt/profile/session repositories | 2–4 days |
| Phase 6 — Migration tooling | 2–4 days |
| Phase 7 — Tests/CI/performance smoke | 2–4 days |
| Phase 8 — Docs/rollout | 1–2 days |
| **Total** | **16–27 engineering days** |

The lower end assumes no major surprises in async conversion and test setup. The upper end is more realistic if full repository contract tests and migration tooling are implemented carefully.

---

## 9. Recommended First PR Scope

Keep the first PR small and behavior-preserving:

1. Add config keys with default `sqlite`.
2. Add `MemoryRepository` interface.
3. Add `SqliteMemoryRepository` wrapping current SQLite managers.
4. Update `LocalMemoryClient` to use the repository.
5. Add tests proving current SQLite behavior still works.

Do **not** add Postgres in the first PR. This creates a clean seam and reduces risk before the real backend implementation begins.
