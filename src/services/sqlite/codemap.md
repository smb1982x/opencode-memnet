# src/services/sqlite/ — SQLite Data Access Layer

## Responsibility

This folder implements the **persistence layer** for the memory system. It owns all SQLite interactions — bootstrapping the runtime dependency (`bun:sqlite`), managing connections, sharding memory records across multiple database files, and executing vector similarity search against stored embeddings.

The layer provides four key capabilities:

1. **Connection lifecycle** — Open, configure, cache, checkpoint, and close SQLite databases.
2. **Shard management** — Partition memory records by scope (`user`/`project`) and scope hash, with automatic rollover when a shard reaches capacity.
3. **Vector search** — Store and query `Float32Array` embedding vectors alongside structured metadata, delegating the actual nearest-neighbor computation to pluggable vector backends.
4. **Schema definition & migration** — Define the `memories` and `shards` table schemas, and run lightweight additive migrations (e.g. adding the `tags` column after the fact).

The folder does **not** own the embedding computation (done in `../embedding.ts`), the business-logic orchestration (done in `../client.ts`), or the vector index backends themselves (done in `../vector-backends/`). It is a data-access layer that other services consume.

---

## Design Patterns

### Singleton / Module-Level Export
Every class exports a singleton instance at module level:
- `connectionManager` (line 85 of `connection-manager.ts`)
- `shardManager` (line 329 of `shard-manager.ts`)
- `vectorSearch` (line 372 of `vector-search.ts`)

Consumers import the singleton directly rather than instantiating the class. The pattern avoids accidental duplicate connection pools and shard registries.

### Lazy Bootstrap of Runtime Dependency
`sqlite-bootstrap.ts` wraps `require("bun:sqlite")` in a getter function (`getDatabase()`) that initializes the `Database` constructor exactly once. This indirection:
- Defers the Bun-specific import until first use, allowing tests and non-Bun contexts to mock or skip it.
- Lets every other module in this folder call `getDatabase()` to obtain the constructor reference without worrying about import order.

### Connection Caching via `ConnectionManager`
The `ConnectionManager` class maintains a `Map<string, Database>` keyed by absolute file path. `getConnection()` returns an existing handle or creates + configures a new one. `closeConnection()` and `closeAll()` checkpoint WAL before closing. This ensures:
- Each physical `.db` file has at most one open `Database` handle.
- Pragmas (`busy_timeout`, `WAL`, `synchronous = NORMAL`, `cache_size`, `temp_store`, `foreign_keys`) are applied once on creation.

### Shard-on-Write with Active/Inactive States
`ShardManager` implements a **write-shard** pattern:
- `getWriteShard()` returns the current active shard for a `(scope, scopeHash)` pair.
- If no shard exists → creates shard index 0.
- If the shard file is missing or corrupt → deletes the metadata row and recreates the shard at the same index.
- If `vectorCount >= CONFIG.maxVectorsPerShard` → marks the shard as `is_active = 0` and creates a new shard at `index + 1`.
- All shards remain readable (inactive shards are still included in `getAllShards()` and searched over).

Reads always scan **all** shards for the scope — inactive shards are never excluded from queries.

### Strategy Pattern for Vector Search Backend
`VectorSearch` accepts an optional `VectorBackend` in its constructor; if omitted it resolves one via `createVectorBackend()` (the backend factory). It keeps a `fallbackBackend` (always `ExactScanBackend`). During `searchInShard()`:
- It attempts the primary backend (e.g. USearch).
- On failure, it logs a degradation warning and retries with the exact-scan fallback.
- The backend interface is defined in `../vector-backends/types.ts` with methods: `insert`, `insertBatch`, `delete`, `search`, `rebuildFromShard`, `deleteShardIndexes`.

This keeps index-specific logic (HNSW graphs, IVF, exact scan) entirely outside this folder.

### Two-Vector Scoring with Exact-Match Boost
Each memory stores two `Float32Array` vectors:
- `vector` — content embedding.
- `tagsVector` — tag embedding.

`searchInShard()` queries both, merges results into a `scoreMap`, then combines them:
```
similarity = contentSim * 0.6 + tagsSim * 0.4
```
An additional `exactMatchBoost` is computed from query-text word overlap with stored tags, applied as `finalTagsSim = max(tagsSim, exactMatchBoost)`.

---

## Data & Control Flow

### Shard Lifecycle

```
                        ┌─────────────────────────────┐
                        │       ShardManager           │
                        │  (metadata.db: shards table) │
                        └──────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
      getWriteShard()      getAllShards()       deleteShard()
              │                    │                    │
              ▼                    ▼                    ▼
      ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
      │ user_<hash>   │    │ user_<hash>   │    │ (cleanup:    │
      │ _shard_N.db   │    │ _shard_0..N   │    │  rm + close) │
      └──────────────┘    └──────────────┘    └──────────────┘
```

**Write path** (called from `client.ts`, `api-handlers.ts`, `migration-service.ts`):
```
shardManager.getWriteShard(scope, hash)
    │
    ├── metadata.db: SELECT active shard
    ├── if none → createShard(scope, hash, 0)
    │      ├── INSERT into metadata.db: shards row
    │      ├── connectionManager.getConnection(fullPath)
    │      └── initShardDb(): CREATE memories table + indexes
    │
    ├── if shard file missing → DELETE metadata row → createShard again
    │
    └── if vectorCount >= max → UPDATE is_active = 0 → createShard(index + 1)

vectorSearch.insertVector(db, record, shard)
    ├── db.prepare(INSERT INTO memories ...).run(...)  // synchronous
    └── backend.insert({ id, vector, shard, kind })    // async index update

shardManager.incrementVectorCount(shard.id)
    └── UPDATE shards SET vector_count = vector_count + 1
```

**Read/search path** (called from `client.ts`, `api-handlers.ts`):
```
shardManager.getAllShards(scope, hash)  // all shards, active + inactive
    │
    └── for each shard:
         vectorSearch.searchInShard(shard, queryVector, tag, limit, queryText)
              │
              ├── connectionManager.getConnection(shard.dbPath)
              ├── backend.rebuildFromShard(db, shard, kind)  // warm index
              ├── backend.search(...)                         // nearest neighbors
              │   └── on failure: fallbackBackend.search(...)
              │
              ├── merge content + tags scores into scoreMap
              ├── SELECT * FROM memories WHERE id IN (...) AND container_tag = ?
              ├── compute exactMatchBoost from queryText ↔ tags
              ├── combine similarity = content * 0.6 + tags * 0.4
              └── sort DESC by similarity

vectorSearch.searchAcrossShards(shards, ...)
    └── Promise.all(searchInShard per shard)
    └── merge, sort, filter by threshold, slice(limit)
```

**Delete path**:
```
vectorSearch.deleteVector(db, memoryId, shard)
    ├── DELETE FROM memories WHERE id = ?
    └── backend.delete({ id, shard, kind })  // content + tags

shardManager.decrementVectorCount(shard.id)
    └── UPDATE shards SET vector_count = vector_count - 1 WHERE vector_count > 0
```

**Connection lifecycle**:
```
connectionManager.getConnection(dbPath)
    ├── cache hit → return existing handle
    ├── cache miss → new Database(dbPath)
    │     ├── mkdir -p (recursive)
    │     └── PRAGMA: busy_timeout, WAL, synchronous, cache_size, temp_store, foreign_keys
    │
    └── return handle

connectionManager.closeConnection(dbPath)
    └── PRAGMA wal_checkpoint(TRUNCATE) → db.close() → map delete

connectionManager.closeAll()
    └── iterate map: checkpoint each, close each, clear map

connectionManager.checkpointAll()
    └── iterate map: PRAGMA wal_checkpoint(PASSIVE)
```

---

## Integration Points

### Consumed By

| Consumer file | What it imports | Usage |
|---|---|---|
| `src/services/client.ts` | `shardManager`, `vectorSearch`, `connectionManager`, `MemoryRecord` | Public API orchestration: search, remember, forget, list, tag listing. Writes go through `getWriteShard` → `insertVector` → `incrementVectorCount`. Reads use `searchAcrossShards` or `listMemories`. |
| `src/services/api-handlers.ts` | `shardManager`, `vectorSearch`, `connectionManager` | HTTP/REST handlers for memory CRUD, tag listing, stats. Directly uses all three singletons. |
| `src/services/migration-service.ts` | `shardManager`, `connectionManager`, `vectorSearch` | Re-encodes memories when embedding model/dimensions change. Reads all shards, recomputes vectors, deletes old shards, inserts into new shards. |
| `src/services/cleanup-service.ts` | `shardManager`, `vectorSearch`, `connectionManager` | Periodic cleanup of stale memories. Iterates all shards, deletes expired records, decrements vector counts. |
| `src/services/deduplication-service.ts` | `shardManager`, `vectorSearch`, `connectionManager` | Finds and removes duplicate memories across shards. Uses `getAllMemories` + `deleteVector`. |
| `src/services/user-profile/user-profile-manager.ts` | `getDatabase`, `connectionManager` | Manages user profile data in its own `.db` file (separate from memory shards). Uses `connectionManager.getConnection()` for caching. |
| `src/services/user-prompt/user-prompt-manager.ts` | `getDatabase`, `connectionManager` | Manages user prompt data in its own `.db` file. Same pattern as user-profiles. |
| `src/services/ai/session/ai-session-manager.ts` | `getDatabase`, `connectionManager` | Manages AI session data in its own `.db` file. |
| `src/index.ts` | `connectionManager` (dynamic import) | App entry point: calls `connectionManager.closeAll()` during shutdown. |

### Depends On

| External module | What it provides | How it's used |
|---|---|---|
| `bun:sqlite` (runtime) | `Database` class | All SQLite operations — `new Database(path)`, `db.prepare()`, `db.run()`, `db.get()`, `db.all()`, `db.close()`. Bun-specific; loaded lazily via `getDatabase()`. |
| `../vector-backends/backend-factory.ts` | `createVectorBackend()` | Constructs the primary `VectorBackend` (USearch or exact-scan) based on `CONFIG.vectorBackend`. Called by `VectorSearch` constructor. |
| `../vector-backends/exact-scan-backend.ts` | `ExactScanBackend` | Hardcoded fallback for degraded search. Always available. |
| `../vector-backends/types.ts` | `VectorBackend` interface, `ShardInfo` re-export, `VectorKind` | Type contracts that decouple this layer from index implementations. |
| `../../config.ts` | `CONFIG` — `storagePath`, `embeddingDimensions`, `embeddingModel`, `maxVectorsPerShard`, `vectorBackend` | All configuration consumed by this layer. |
| `../logger.ts` | `log()` | Structured logging for errors, degradations, and lifecycle events. |

### Shard File Layout on Disk

```
{CONFIG.storagePath}/
├── metadata.db              ← ShardManager's registry (shards table)
├── users/
│   └── user_<hash>_shard_0.db
│   └── user_<hash>_shard_1.db   ← after capacity rollover
├── projects/
│   └── project_<hash>_shard_0.db
├── user-profiles.db         ← owned by UserProfileManager (separate)
├── user-prompts.db          ← owned by UserPromptManager (separate)
└── ai-sessions.db           ← owned by AiSessionManager (separate)
```

Each shard `.db` file contains a `memories` table (16 columns) plus 4 secondary indexes, and a `shard_metadata` table that records the embedding model/dimensions that were used when the shard was created. The `metadata.db` `shards` table tracks every shard with its scope, hash, index, path, vector count, and active flag.

### Key Architectural Invariants

1. **A shard's `memories` table is the source of truth** for metadata/content. The vector backend index is a derived structure that can be rebuilt via `rebuildFromShard()`.
2. **vector count in metadata.db is an approximation** — it is incremented/decremented optimistically but is never validated against the actual row count. The migration service uses `countAllVectors()` when it needs exact counts.
3. **All shards for a scope are always searched** — there is no read-write split. Inactive shards participate fully in queries.
4. **WAL mode is always enabled** on every connection, with passive checkpoints during normal operation and truncating checkpoints on close.
5. **Embedding model/dimensions are per-shard** — stored in `shard_metadata` so different shards can theoretically use different models, though in practice the config is global.
