# src/services/vector-backends/

Pluggable vector similarity search backends. Implements a Strategy pattern with two concrete backends — USearch (ANN) and exact-scan (brute-force cosine) — composed via a fallback-aware proxy that degrades gracefully when the primary backend fails.

---

## Responsibility

- Define the `VectorBackend` interface that decouples vector-index operations (insert, delete, search, rebuild) from the consuming `VectorSearch` service.
- Provide two implementations:
  - **USearch** — approximate nearest-neighbor (ANN) search via the `usearch` native module; fast but optional (may not be installed).
  - **Exact-scan** — brute-force cosine similarity over all vectors in a shard; always available, zero dependencies.
- Expose a factory (`createVectorBackend`) that selects the backend at startup based on configuration (`CONFIG.vectorBackend`) and runtime availability of the `usearch` module.
- Wrap the selected primary backend in a `FallbackAwareBackend` proxy that automatically degrades to exact-scan when the primary throws (e.g., missing native bindings, index corruption).

---

## Design Patterns

| Pattern | Where | Rationale |
|---|---|---|
| **Strategy** | `VectorBackend` interface + `USearchBackend` / `ExactScanBackend` | Swap search algorithms without changing callers. |
| **Factory Method** | `createVectorBackend(options)` | Encapsulates configuration logic, probing, construction, and fallback wiring. |
| **Decorator / Proxy** | `FallbackAwareBackend` | Transparently wraps a primary backend; catches errors on `search`/`rebuildFromShard` and retries on the fallback. `deleteShardIndexes` fans out to both. |
| **Lazy Initialization** | `USearchBackend.getOrCreateIndex()` | In-memory `Index` objects are created on first access, not at construction time. |
| **Index Rebuild** | `rebuildFromShard()` | Populates an empty index by reading raw vectors from SQLite; used both at startup (lazy) and as a repair mechanism. |

**Fallback semantics**:
- `"usearch-first"` — prefer USearch, degrade silently (severity `"info"`) if unavailable.
- `"usearch"` — require USearch; if unavailable log at severity `"warning"` (caller may alert operator).
- `"exact-scan"` — skip USearch entirely, use exact-scan unconditionally.

Once degraded, the `FallbackAwareBackend` permanently points to the fallback for the process lifetime (no re-probe).

---

## Data & Control Flow

### Insert path

```
VectorSearch.insertVector()
  └─ SQLite: INSERT INTO memories (id, content, vector, tags_vector, ...)
  └─ backend.insert({ id, vector, shard, kind: "content" })
       └─ USearchBackend: getOrCreateIndex() → upsertItem() → index.add(key, vector)
       └─ ExactScanBackend: no-op (vectors live in SQLite only)
```

- "tags" vectors follow the same path with `kind: "tags"`.
- On backend failure the SQLite row is rolled back (deleted).

### Search path

```
VectorSearch.searchInShard()
  ├─ backend.rebuildFromShard({ kind: "content" })   ← populate index from SQLite
  ├─ backend.rebuildFromShard({ kind: "tags" })
  ├─ backend.search({ kind: "content", queryVector })  → BackendSearchResult[]
  ├─ backend.search({ kind: "tags", queryVector })      → BackendSearchResult[]
  └─ fusion: weighted blend (60% content, 40% tags) + exact-match boost
```

- **USearch**: delegates to `index.search(query, limit)` which returns `{ keys, distances }` from the ANN index. A bidirectional id↔bigint mapping (`idToKey` / `keyToId`) resolves opaque index keys back to application-level string IDs.
- **Exact-scan**: reads all non-null vector rows from the `memories` table, decodes the binary `Uint8Array` → `Float32Array`, computes cosine similarity = `dot(a,b) / (|a|·|b|)`, converts to distance (`1 - similarity`), sorts ascending, returns top-k.

### Degradation control flow

```
FallbackAwareBackend.search()
  try { return activeBackend.search(args) }
  catch (error) {
    logDegrade("search", error)    ← severity depends on strategy
    activeBackend = fallback        ← permanent switch
    return fallback.search(args)
  }
```

The same pattern applies to `rebuildFromShard`. `deleteShardIndexes` always fans out to both backends to ensure cleanup.

### Index lifecycle

- **Creation**: on first `insert`, `insertBatch`, or `delete` for a given `(shard, kind)` tuple.
- **Rebuild**: `rebuildFromShard` queries SQLite (`SELECT id, vector|tags_vector FROM memories`) and upserts every row. Skips if `initialized` flag is already `true`.
- **Teardown**: `deleteShardIndexes` removes the in-memory entry (no persistent file cleanup in current code — `baseDir` is accepted but unused).

---

## Integration Points

### Consumer

| File | Class/Function | Role |
|---|---|---|
| `src/services/sqlite/vector-search.ts` | `VectorSearch` | Sole consumer. Calls `createVectorBackend` in constructor, delegates all vector operations to the returned `VectorBackend`. |

`VectorSearch` also keeps a separate `fallbackBackend: ExactScanBackend` for its own per-shard catch block (a second fallback layer beyond `FallbackAwareBackend`).

### Configuration

| Key | Type | Source | Effect |
|---|---|---|---|
| `CONFIG.vectorBackend` | `"usearch-first" | "usearch" | "exact-scan"` | `config.ts` | Drives the `vectorBackend` option passed to `createVectorBackend`. |
| `CONFIG.storagePath` | `string` | `config.ts` | Passed as `baseDir` to `USearchBackend` (reserved for future persistent index files). |
| `CONFIG.embeddingDimensions` | `number` | `config.ts` | Sets `dimensions` on the USearch `Index`. |

### Data dependencies

- **SQLite `memories` table** — columns `id TEXT`, `vector BLOB`, `tags_vector BLOB`. Exact-scan reads these directly; USearch rebuilds from them.
- **`ShardInfo`** (`sqlite/types.ts`) — identifies a shard via `{ scope, scopeHash, shardIndex }`. The composite `indexKey = `${scope}_${scopeHash}_${shardIndex}_${kind}`` partitions in-memory indexes.
- **`VectorKind`** — `"content"` | `"tags"` — two independent indexes per shard.

### Test helpers

`USearchBackend` exposes `insertManyForTest` and `searchForTest` that accept a raw `indexKey` string, bypassing shard metadata. These are used by test fixtures to set up and query indexes without a real SQLite database.

### Error & log surface

- `log("Vector backend degraded to exact-scan", { strategy, severity, operation, error })` — emitted on probe failure, construction failure, and runtime degradation.
- `log("Vector search degraded to exact scan in shard", { shardId, backend, error })` — emitted by `VectorSearch.searchInShard` when its own catch block fires.
