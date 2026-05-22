# Detailed Implementation Plan: PostgreSQL + pgvector Storage Backend

This document provides a file-by-file, interface-by-interface implementation plan for replacing local SQLite + local vector indexing with remote PostgreSQL + pgvector, based on the architecture described in `SPEC.md` and `PLAN.md`.

## Critical Constraint

**All vector columns use `vector(1024)`.** Embedding output dimension is 1024 for this rollout. Per-kind lengths (`embeddingMaxTokens`) are input-token truncation only — they control how much text is sent to the embedding model, NOT the dimensionality of the output vector. Both `vector` and `tags_vector` columns MUST be declared as `vector(1024)`. Do NOT propose `tags_vector vector(512)` or truncate `Float32Array` dimensions.

---

## Table of Contents

1. [PR Breakdown (Ordered)](#1-pr-breakdown-ordered)
2. [Concrete Interfaces and Types](#2-concrete-interfaces-and-types)
3. [File-by-File Changes](#3-file-by-file-changes)
4. [Async Conversion Sequence](#4-async-conversion-sequence)
5. [Migration / Schema Tasks](#5-migration--schema-tasks)
6. [Tests and Validation](#6-tests-and-validation)
7. [Rollback Checkpoints](#7-rollback-checkpoints)
8. [Risk Notes](#8-risk-notes)

---

## 1. PR Breakdown (Ordered)

Each PR is self-contained and leaves the codebase in a working state. SQLite remains the default backend until explicitly switched.

### PR 1: Config Keys and Embedding Per-Kind Truncation

**Goal:** Add Postgres-related config keys and per-kind embedding input truncation without changing any storage behavior.

**Files changed:**
- `src/config.ts` — Add `storageBackend`, `postgres`, `embeddingMaxTokens`, `embeddingTruncationSide` to `OpenCodeMemConfig` interface and `buildConfig()`. Defaults: `storageBackend: "sqlite"`, `postgres: { ssl: "require", maxConnections: 10, idleTimeoutSeconds: 30, connectTimeoutSeconds: 10, vectorType: "vector", hnswEfConstruction: 256 }`, `embeddingMaxTokens: { content: 2048, tags: 256, query: 512, migration: 2048 }`, `embeddingTruncationSide: { content: "right", tags: "right", query: "right", migration: "right" }`.
- `src/services/embedding.ts` — Add `EmbeddingKind` type (`"content" | "tags" | "query" | "migration"`), `EmbeddingOptions` interface, update `embed()` and `embedWithTimeout()` signatures to accept `options?: EmbeddingOptions`. Implement app-side right-truncation (character/word-based conservative approximation) and vLLM `truncate_prompt_tokens` for left-truncation. Update cache key to include `${kind}:${maxTokens}:${side}:`.
- `package.json` — No new deps yet (postgres comes in PR 3).

**Validation:** `bun run typecheck`. Unit tests for `EmbeddingOptions` resolution. Existing SQLite tests pass.

---

### PR 2: Storage Interfaces and SQLite Repository Wrappers

**Goal:** Introduce repository interfaces and wrap existing SQLite behavior behind them. No behavior change.

**New files:**
- `src/services/storage/types.ts` — All repository interfaces and shared types.
- `src/services/storage/factory.ts` — Factory that returns `SqliteMemoryRepository` (for now).
- `src/services/storage/sqlite-memory-repository.ts` — Wraps `shardManager`, `connectionManager`, `vectorSearch`.
- `src/services/storage/sqlite-user-prompt-repository.ts` — Wraps `UserPromptManager`.
- `src/services/storage/sqlite-user-profile-repository.ts` — Wraps `UserProfileManager`.
- `src/services/storage/sqlite-ai-session-repository.ts` — Wraps `AISessionManager`.

**Modified files:**
- `src/services/client.ts` — `LocalMemoryClient` constructor accepts `MemoryRepository`, `UserPromptRepository`, `UserProfileRepository`, `AISessionRepository`. Delegates to repositories instead of calling `shardManager`/`connectionManager`/`vectorSearch` directly. `close()` becomes `async close()`.
- `src/services/api-handlers.ts` — Uses repositories from factory instead of direct SQLite imports.
- `src/services/cleanup-service.ts` — Uses `MemoryRepository` and `UserPromptRepository`.
- `src/services/deduplication-service.ts` — Uses `MemoryRepository`.
- `src/services/migration-service.ts` — Uses `MemoryRepository` (note: this is embedding model migration within SQLite, not SQLite-to-Postgres migration).
- `src/services/auto-capture.ts` — Uses `UserPromptRepository`.
- `src/services/user-memory-learning.ts` — Uses `UserPromptRepository`, `UserProfileRepository`.
- `src/index.ts` — Updates `shutdownHandler` to `await memoryClient.close()`.

**Validation:** `bun run typecheck`. All existing tests pass. Manual smoke: add, search, list, delete memory.

**Rollback checkpoint:** SQLite behavior is unchanged. If issues arise, revert this PR.

---

### PR 3: Postgres Client, Schema Migrations, and Vector Helpers

**Goal:** Add `postgres` dependency, client singleton, migration runner, and vector utility functions. No runtime usage yet.

**New files:**
- `src/services/storage/postgres/client.ts` — Postgres.js client singleton with lazy initialization, health check (`SELECT 1`), connection pool configuration, redacted logging, and `close()`.
- `src/services/storage/postgres/migrations.ts` — Numbered migration runner. Creates `schema_migrations`, `embedding_config`, all tables from SPEC §6.
- `src/services/storage/postgres/vector.ts` — `vectorToPgLiteral()`, `assertVectorDimensions()`, `decodeSqliteVectorBlob()`, `getVectorCast()`, `redactDatabaseUrl()`.

**Modified files:**
- `package.json` — Add `"postgres": "^3.4"` to dependencies.

**Validation:** `bun run typecheck`. Integration smoke: point at empty Postgres + pgvector DB, run migrations, verify tables and indexes exist.

---

### PR 4: Postgres Memory Repository

**Goal:** Implement `PostgresMemoryRepository` that fulfills `MemoryRepository` interface using pgvector.

**New files:**
- `src/services/storage/postgres/memory-repository.ts` — Full implementation.

**Modified files:**
- `src/services/storage/factory.ts` — When `CONFIG.storageBackend === "postgres"`, create Postgres client, run migrations, return `PostgresMemoryRepository`.

**Validation:** Integration tests against Postgres for: insert, get, delete, list, search (content + tags weighted), all-projects search, session ID lookup, pin/unpin, count, distinct tags. Typecheck passes.

---

### PR 5: Postgres Prompt, Profile, and Session Repositories

**Goal:** Implement all non-memory Postgres repositories.

**New files:**
- `src/services/storage/postgres/prompt-repository.ts`
- `src/services/storage/postgres/profile-repository.ts`
- `src/services/storage/postgres/ai-session-repository.ts`

**Modified files:**
- `src/services/storage/factory.ts` — Returns Postgres repositories when backend is `"postgres"`.

**Validation:** Contract tests for each repository. Auto-capture, user-profile learning, and AI provider sessions work against Postgres.

---

### PR 6: SQLite-to-Postgres Migration Tool

**Goal:** Add migration command that reads SQLite data and writes to Postgres.

**New files:**
- `src/services/storage/postgres/sqlite-importer.ts`
- `scripts/migrate-to-postgres.ts` (or bin entry in `package.json`)

**Validation:** Migration fixture tests with multiple shards. Idempotent rerun. Dimension mismatch detection. Count verification.

---

### PR 7: Tests, CI, and Documentation

**Goal:** Shared contract test suites, CI configuration, docs.

**New files:**
- `tests/storage/memory-repository.contract.ts`
- `tests/storage/user-prompt-repository.contract.ts`
- `tests/storage/user-profile-repository.contract.ts`
- `tests/storage/ai-session-repository.contract.ts`
- `tests/storage/postgres-memory-repository.test.ts`
- `tests/storage/postgres-migrations.test.ts`
- `tests/storage/postgres-vector-utils.test.ts`
- `tests/storage/sqlite-to-postgres-migration.test.ts`
- `docker-compose.test.yml` (optional Postgres + pgvector test service)

**Validation:** Full test suite passes for both SQLite and Postgres backends.

---

## 2. Concrete Interfaces and Types

### `src/services/storage/types.ts`

```typescript
// ── Backend selection ──

export type StorageBackend = "sqlite" | "postgres";
export type MemoryScopeKind = "user" | "project";

// ── Search and query types ──

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

// ── Row/result types ──

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

export interface SearchResult {
  id: string;
  memory: string;
  similarity: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
  containerTag?: string;
}

export interface TagInfo {
  tag: string;
  tags?: string[];
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

export interface MemoryRecord {
  id: string;
  content: string;
  vector: Float32Array;
  tagsVector?: Float32Array;
  containerTag: string;
  tags?: string;
  type?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

// ── Memory repository interface ──

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

  count(args?: {
    containerTag?: string;
    scope?: MemoryScopeKind;
    scopeHash?: string;
  }): Promise<number>;

  getDistinctTags(args?: {
    scope?: MemoryScopeKind;
    scopeHash?: string;
  }): Promise<TagInfo[]>;

  pin(memoryId: string): Promise<void>;
  unpin(memoryId: string): Promise<void>;
}

// ── User prompt repository interface ──

export interface UserPromptRow {
  id: string;
  sessionId: string;
  messageId: string;
  projectPath: string | null;
  content: string;
  createdAt: number;
  captured: number;       // 0=uncaptured, 1=captured, 2=claimed
  userLearningCaptured: boolean;
  linkedMemoryId: string | null;
}

export interface UserPromptRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  savePrompt(sessionId: string, messageId: string, projectPath: string, content: string): Promise<string>;
  getLastUncapturedPrompt(sessionId: string): Promise<UserPromptRow | null>;
  deletePrompt(promptId: string): Promise<void>;
  markAsCaptured(promptId: string): Promise<void>;
  claimPrompt(promptId: string): Promise<boolean>;
  countUncapturedPrompts(): Promise<number>;
  getUncapturedPrompts(limit: number): Promise<UserPromptRow[]>;
  markMultipleAsCaptured(promptIds: string[]): Promise<void>;
  countUnanalyzedForUserLearning(): Promise<number>;
  getPromptsForUserLearning(limit: number): Promise<UserPromptRow[]>;
  markAsUserLearningCaptured(promptId: string): Promise<void>;
  markMultipleAsUserLearningCaptured(promptIds: string[]): Promise<void>;
  deleteOldPrompts(cutoffTime: number): Promise<{ deleted: number; linkedMemoryIds: string[] }>;
  linkMemoryToPrompt(promptId: string, memoryId: string): Promise<void>;
  getPromptById(promptId: string): Promise<UserPromptRow | null>;
  getCapturedPrompts(projectPath?: string): Promise<UserPromptRow[]>;
  searchPrompts(query: string, projectPath?: string, limit?: number): Promise<UserPromptRow[]>;
  getPromptsByIds(ids: string[]): Promise<UserPromptRow[]>;
}

// ── User profile repository interface ──

export interface UserProfileData {
  preferences: any[];
  patterns: any[];
  workflows: any[];
}

export interface UserProfileRow {
  id: string;
  userId: string;
  displayName: string;
  userName: string;
  userEmail: string;
  profileData: string;
  version: number;
  createdAt: number;
  lastAnalyzedAt: number;
  totalPromptsAnalyzed: number;
  isActive: boolean;
}

export interface UserProfileChangelogRow {
  id: string;
  profileId: string;
  version: number;
  changeType: string;
  changeSummary: string;
  profileDataSnapshot: string;
  createdAt: number;
}

export interface UserProfileRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  getActiveProfile(userId: string): Promise<UserProfileRow | null>;
  getProfileById(profileId: string): Promise<UserProfileRow | null>;
  getAllActiveProfiles(): Promise<UserProfileRow[]>;
  createProfile(userId: string, displayName: string, userName: string, userEmail: string, profileData: UserProfileData, promptsAnalyzed: number): Promise<string>;
  updateProfile(profileId: string, profileData: UserProfileData, additionalPromptsAnalyzed: number, changeSummary: string): Promise<void>;
  deleteProfile(profileId: string): Promise<void>;
  applyConfidenceDecay(profileId: string): Promise<void>;
  getProfileChangelogs(profileId: string, limit?: number): Promise<UserProfileChangelogRow[]>;
}

// ── AI session repository interface ──

export interface AISessionRow {
  id: string;
  provider: string;
  sessionId: string;
  conversationId?: string;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface AIMessageRow {
  id?: number;
  aiSessionId: string;
  sequence: number;
  role: string;
  content: string;
  toolCalls?: any;
  toolCallId?: string;
  contentBlocks?: any;
  createdAt: number;
}

export interface AISessionRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  getSession(sessionId: string, provider: string): Promise<AISessionRow | null>;
  createSession(params: { provider: string; sessionId: string; conversationId?: string; metadata?: Record<string, any> }): Promise<AISessionRow>;
  updateSession(sessionId: string, provider: string, updates: { conversationId?: string; metadata?: Record<string, any> }): Promise<void>;
  deleteSession(sessionId: string, provider: string): Promise<void>;
  cleanupExpiredSessions(): Promise<number>;

  addMessage(message: Omit<AIMessageRow, "id" | "createdAt">): Promise<void>;
  getMessages(aiSessionId: string): Promise<AIMessageRow[]>;
  getLastSequence(aiSessionId: string): Promise<number>;
  clearMessages(aiSessionId: string): Promise<void>;
}
```

### `src/services/embedding.ts` additions

```typescript
export type EmbeddingKind = "content" | "tags" | "query" | "migration";

export interface EmbeddingOptions {
  kind?: EmbeddingKind;
  truncationSide?: "left" | "right";
}

// Updated signatures:
async embed(text: string, options?: EmbeddingOptions): Promise<Float32Array>;
async embedWithTimeout(text: string, options?: EmbeddingOptions): Promise<Float32Array>;
```

### `src/config.ts` additions to `OpenCodeMemConfig`

```typescript
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

---

## 3. File-by-File Changes

### 3.1 `src/config.ts`

**Changes:**
1. Add fields to `OpenCodeMemConfig` interface (see types above).
2. Add defaults to `DEFAULTS` object.
3. Add `storageBackend`, `postgres`, `embeddingMaxTokens`, `embeddingTruncationSide` to `buildConfig()`.
4. Resolve `postgres.url` through `resolveSecretValue()`.
5. Validate: if `storageBackend === "postgres"` and `postgres.url` is not set, throw a clear error.
6. Do not log `postgres.url` — use `redactDatabaseUrl()` for any log output.

### 3.2 `src/services/embedding.ts`

**Changes:**
1. Add `EmbeddingKind` and `EmbeddingOptions` types (exported).
2. Add private method `resolveMaxTokens(kind?: EmbeddingKind): number | undefined`.
3. Add private method `truncateText(text: string, maxTokens: number, side: "left" | "right"): string`.
   - Conservative approximation: ~4 characters per token for English code/text.
   - `side: "right"` → keep first `maxTokens` tokens (truncate from end).
   - `side: "left"` → keep last `maxTokens` tokens (truncate from beginning).
4. Update `embed(text, options?)` signature:
   - Resolve `kind = options?.kind ?? "content"`.
   - Resolve `maxTokens = resolveMaxTokens(kind)`.
   - Resolve `side = options?.truncationSide ?? CONFIG.embeddingTruncationSide[kind] ?? "right"`.
   - If `maxTokens` and text exceeds approximate token count, apply `truncateText`.
   - For remote embeddings (`CONFIG.embeddingApiUrl` set):
     - If `side === "left"`, pass `truncate_prompt_tokens: maxTokens` in request body.
     - If `side === "right"`, truncate before request (already done above).
   - Cache key: `${kind}:${maxTokens}:${side}:${text}`.
5. Update `embedWithTimeout(text, options?)` to pass `options` through.

### 3.3 `src/services/storage/types.ts` (new)

Full content as specified in §2 above.

### 3.4 `src/services/storage/factory.ts` (new)

```typescript
import { CONFIG } from "../../config.js";
import type { StorageBackend, MemoryRepository, UserPromptRepository, UserProfileRepository, AISessionRepository } from "./types.js";

export function createMemoryRepository(): MemoryRepository { ... }
export function createUserPromptRepository(): UserPromptRepository { ... }
export function createUserProfileRepository(): UserProfileRepository { ... }
export function createAISessionRepository(): AISessionRepository { ... }

export async function initializeStorage(): Promise<{
  memoryRepo: MemoryRepository;
  promptRepo: UserPromptRepository;
  profileRepo: UserProfileRepository;
  sessionRepo: AISessionRepository;
}> {
  const memoryRepo = createMemoryRepository();
  const promptRepo = createUserPromptRepository();
  const profileRepo = createUserProfileRepository();
  const sessionRepo = createAISessionRepository();

  await memoryRepo.initialize();
  await promptRepo.initialize();
  await profileRepo.initialize();
  await sessionRepo.initialize();

  return { memoryRepo, promptRepo, profileRepo, sessionRepo };
}

export async function closeStorage(): Promise<void> {
  // Close all repositories (idempotent)
}
```

Initially returns SQLite implementations. After PR 4, routes by `CONFIG.storageBackend`.

### 3.5 `src/services/storage/sqlite-memory-repository.ts` (new)

Wraps existing `shardManager`, `connectionManager`, `vectorSearch` behind `MemoryRepository`.

Key mapping:
- `insert(record)` → `extractScopeFromContainerTag(record.containerTag)` → `shardManager.getWriteShard(scope, hash)` → `connectionManager.getConnection(shard.dbPath)` → `vectorSearch.insertVector(db, record, shard)` → `shardManager.incrementVectorCount(shard.id)`.
- `search(options)` → `shardManager.getAllShards(options.scope, options.scopeHash)` → `vectorSearch.searchAcrossShards(shards, options.queryVector, options.containerTag, options.limit, options.similarityThreshold, options.queryText)`.
- `list(args)` → iterate shards → `vectorSearch.listMemories(db, containerTag, limit)` → merge and sort by `created_at DESC`.
- `getBySessionId(args)` → iterate shards → `vectorSearch.getMemoriesBySessionID(db, args.sessionId)` → merge and sort.
- `count(args?)` → iterate shards → `vectorSearch.countVectors(db, containerTag)` or `countAllVectors(db)`.
- `getDistinctTags(args?)` → iterate shards → `vectorSearch.getDistinctTags(db)`.
- `pin(id)` / `unpin(id)` → find shard containing memory → `vectorSearch.pinMemory(db, id)`.
- `delete(id)` → find shard → `vectorSearch.deleteVector(db, id, shard)` → `shardManager.decrementVectorCount(shard.id)`.
- `close()` → `connectionManager.closeAll()`.

All methods are `async` even though underlying SQLite calls are synchronous.

### 3.6 `src/services/storage/sqlite-user-prompt-repository.ts` (new)

Delegates to existing `UserPromptManager` instance. All methods are async wrappers around synchronous calls.

### 3.7 `src/services/storage/sqlite-user-profile-repository.ts` (new)

Delegates to existing `UserProfileManager` instance. Async wrappers.

### 3.8 `src/services/storage/sqlite-ai-session-repository.ts` (new)

Delegates to existing `AISessionManager` instance. Async wrappers.

### 3.9 `src/services/client.ts`

**Major changes:**
1. Remove direct imports of `shardManager`, `connectionManager`, `vectorSearch`.
2. Constructor receives repositories from factory.
3. `addMemory()` → calls `this.memoryRepo.insert(record)` after computing embeddings.
4. `searchMemories()` → calls `this.memoryRepo.search(options)`.
5. `listMemories()` → calls `this.memoryRepo.list(args)`.
6. `deleteMemory()` → calls `this.memoryRepo.delete(id)`.
7. `searchMemoriesBySessionID()` → calls `this.memoryRepo.getBySessionId(args)`.
8. `close()` → `async close()` → `await this.memoryRepo.close()`.
9. Add `pinMemory(id)` and `unpinMemory(id)` methods that delegate to repository.
10. Embedding calls updated with `EmbeddingOptions`:
    - Query embedding: `{ kind: "query" }`
    - Content embedding: `{ kind: "content" }`
    - Tags embedding: `{ kind: "tags" }`

### 3.10 `src/services/api-handlers.ts`

**Changes:**
1. Remove direct imports of `shardManager`, `connectionManager`, `vectorSearch`.
2. Import repositories from `storage/factory.ts`.
3. `handleListTags()` → `memoryRepo.getDistinctTags()`.
4. `handleListMemories()` → `memoryRepo.list()`.
5. `handleAddMemory()` → compute embeddings, then `memoryRepo.insert()`.
6. `handleDeleteMemory()` → `memoryRepo.delete()`.
7. `handleUpdateMemory()` → `memoryRepo.delete()` then `memoryRepo.insert()` (or add `update()` usage).
8. `handleSearch()` → `memoryRepo.search()`.
9. `handleStats()` → `memoryRepo.count()`.
10. `handlePinMemory()` / `handleUnpinMemory()` → `memoryRepo.pin()` / `memoryRepo.unpin()`.
11. All prompt handlers → `promptRepo.*()`.
12. All profile handlers → `profileRepo.*()`.
13. `handleRunTagMigrationBatch()` → needs embedding calls with `{ kind: "content" }` and `{ kind: "tags" }`.

### 3.11 `src/services/cleanup-service.ts`

**Changes:**
1. Remove direct imports of `shardManager`, `connectionManager`, `vectorSearch`.
2. Accept `MemoryRepository` and `UserPromptRepository` (inject or import from factory).
3. `runCleanup()`:
   - Get pinned memory IDs → `memoryRepo.list({ scope, scopeHash, includeAllContainers: true, limit: Infinity })` filtered by `isPinned`.
   - Delete old prompts → `promptRepo.deleteOldPrompts(cutoffTime)`.
   - Delete old memories → iterate stale memories → `memoryRepo.delete(id)`.
   - Current code uses `db.prepare(SELECT ... WHERE updated_at < ?)` directly. Need `MemoryRepository.listOlderThan(cutoffTime)` or perform filtering in TypeScript after list.

   **Design decision:** Add `listOlderThan` to `MemoryRepository` or handle in cleanup service via a broader `list` + filter. Recommended: add `listOlderThan(cutoffTime: number): Promise<MemoryRow[]>` to keep cleanup efficient.

### 3.12 `src/services/deduplication-service.ts`

**Changes:**
1. Remove direct imports of `shardManager`, `connectionManager`, `vectorSearch`.
2. Accept `MemoryRepository`.
3. `detectAndRemoveDuplicates()`:
   - Get all memories → `memoryRepo.list({ scope, scopeHash, includeAllContainers: true, limit: Infinity })` — but this does not return raw vectors.
   - **Design decision:** Need `MemoryRepository.getAllWithVectors()` or keep dedup-specific method. Add `getAllWithVectors(): Promise<Array<MemoryRecord>>` to interface for dedup usage.
   - Compute cosine similarity in TypeScript (same as current).
   - Delete duplicates via `memoryRepo.delete(id)`.

### 3.13 `src/services/migration-service.ts`

**Changes:**
1. Remove direct imports of `shardManager`, `connectionManager`, `vectorSearch`.
2. This service handles embedding model/dimension migration *within SQLite*. It is separate from SQLite-to-Postgres migration.
3. Keep using SQLite repositories for this purpose, since it operates on shard structure.
4. Embedding calls use `{ kind: "migration" }`.

### 3.14 `src/services/storage/postgres/client.ts` (new)

```typescript
import postgres from "postgres";
import { CONFIG } from "../../../config.js";
import { log } from "../../logger.js";

export type SqlClient = postgres.Sql;

let sqlInstance: SqlClient | null = null;

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "[invalid-url-redacted]";
  }
}

export function getPostgresClient(): SqlClient {
  if (sqlInstance) return sqlInstance;

  const url = CONFIG.postgres!.url!;
  sqlInstance = postgres(url, {
    max: CONFIG.postgres!.maxConnections ?? 10,
    idle_timeout: (CONFIG.postgres!.idleTimeoutSeconds ?? 30) as any,
    connect_timeout: (CONFIG.postgres!.connectTimeoutSeconds ?? 10) as any,
    ssl: CONFIG.postgres!.ssl === false ? false : "require",
    onnotice: () => {}, // suppress NOTICE messages
  });

  return sqlInstance;
}

export async function closePostgresClient(): Promise<void> {
  if (sqlInstance) {
    await sqlInstance.end();
    sqlInstance = null;
  }
}

export async function checkPostgresHealth(): Promise<void> {
  const sql = getPostgresClient();
  await sql`SELECT 1`;
}
```

### 3.15 `src/services/storage/postgres/migrations.ts` (new)

Numbered migration system:

```typescript
interface Migration {
  version: number;
  description: string;
  up: (sql: SqlClient) => Promise<void>;
  transactional: boolean; // false for CREATE INDEX CONCURRENTLY
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "Create schema_migrations table",
    transactional: true,
    up: async (sql) => {
      await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    },
  },
  {
    version: 2,
    description: "Enable pgvector extension",
    transactional: true,
    up: async (sql) => {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    },
  },
  {
    version: 3,
    description: "Create embedding_config table",
    transactional: true,
    up: async (sql) => { /* SPEC §6.3 */ },
  },
  {
    version: 4,
    description: "Create memories table with vector(1024) columns",
    transactional: true,
    up: async (sql) => { /* SPEC §6.4 — both vector and tags_vector are vector(1024) */ },
  },
  {
    version: 5,
    description: "Create memories indexes (non-vector)",
    transactional: true,
    up: async (sql) => { /* SPEC §6.5 standard indexes */ },
  },
  {
    version: 6,
    description: "Create memories HNSW vector indexes",
    transactional: false, // uses CONCURRENTLY for production
    up: async (sql) => {
      // idx_memories_vector_hnsw
      // idx_memories_tags_vector_hnsw WHERE tags_vector IS NOT NULL
      // Both use vector_cosine_ops, m=16, ef_construction from config
    },
  },
  {
    version: 7,
    description: "Create user_prompts table",
    transactional: true,
    up: async (sql) => { /* SPEC §6.6 */ },
  },
  {
    version: 8,
    description: "Create user_profiles tables",
    transactional: true,
    up: async (sql) => { /* SPEC §6.7 */ },
  },
  {
    version: 9,
    description: "Create ai_sessions and ai_messages tables",
    transactional: true,
    up: async (sql) => { /* SPEC §6.8 */ },
  },
  {
    version: 10,
    description: "Set active embedding config",
    transactional: true,
    up: async (sql) => {
      // Insert/update embedding_config with CONFIG.embeddingModel, CONFIG.embeddingDimensions, CONFIG.postgres.vectorType
    },
  },
];
```

Migration runner:
1. Ensure `schema_migrations` exists.
2. Read `SELECT version FROM schema_migrations ORDER BY version`.
3. For each migration where `version > max(applied)`:
   - If `transactional`: wrap in `sql.begin()` transaction.
   - If not transactional: run directly (for `CREATE INDEX CONCURRENTLY`).
   - Insert `(version, description)` into `schema_migrations`.

Dynamic vector dimension SQL generation:
```typescript
function getVectorColumnType(vectorType: "vector" | "halfvec", dimensions: number): string {
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error("Invalid dimensions");
  if (vectorType === "vector" && dimensions > 2000) throw new Error("vector max dimension is 2000");
  if (vectorType === "halfvec" && dimensions > 4000) throw new Error("halfvec max dimension is 4000");
  return `${vectorType}(${dimensions})`;
}
```

For this rollout: `vectorType === "vector"`, `dimensions === 1024`. Both `vector` and `tags_vector` columns use `vector(1024)`.

### 3.16 `src/services/storage/postgres/vector.ts` (new)

```typescript
export function vectorToPgLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

export function assertVectorDimensions(vector: Float32Array, expectedDimensions: number): void {
  if (vector.length !== expectedDimensions) {
    throw new Error(
      `Vector dimension mismatch: expected ${expectedDimensions}, got ${vector.length}`
    );
  }
}

export function decodeSqliteVectorBlob(blob: Uint8Array | Buffer): Float32Array {
  return new Float32Array(new Uint8Array(blob).buffer);
}

export function getVectorCast(
  vectorType: "vector" | "halfvec",
  dimensions: number
): string {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid dimensions: ${dimensions}`);
  }
  return `${vectorType}(${dimensions})`;
}

export function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "[redacted]";
  }
}
```

### 3.17 `src/services/storage/postgres/memory-repository.ts` (new)

Implements `MemoryRepository` for Postgres.

#### Row mapping (snake_case DB → camelCase domain):

```typescript
function rowToMemoryRow(row: any): MemoryRow {
  return {
    id: row.id,
    content: row.content,
    containerTag: row.container_tag,
    tags: row.tags ? row.tags.split(",").map((t: string) => t.trim()) : [],
    type: row.type ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    displayName: row.display_name ?? undefined,
    userName: row.user_name ?? undefined,
    userEmail: row.user_email ?? undefined,
    projectPath: row.project_path ?? undefined,
    projectName: row.project_name ?? undefined,
    gitRepoUrl: row.git_repo_url ?? undefined,
    isPinned: row.is_pinned ?? false,
  };
}
```

#### Insert:

```typescript
async insert(record: MemoryRecord): Promise<void> {
  const sql = getPostgresClient();
  const dims = CONFIG.embeddingDimensions; // 1024
  const vectorCast = getVectorCast(CONFIG.postgres!.vectorType!, dims);

  assertVectorDimensions(record.vector, dims);
  if (record.tagsVector) assertVectorDimensions(record.tagsVector, dims);

  const { scope, hash } = extractScopeFromContainerTag(record.containerTag);
  const metadata = record.metadata ? JSON.parse(record.metadata) : {};

  await sql`
    INSERT INTO memories (
      id, scope, scope_hash, content, vector, tags_vector,
      container_tag, tags, type, created_at, updated_at,
      metadata, display_name, user_name, user_email,
      project_path, project_name, git_repo_url, is_pinned
    ) VALUES (
      ${record.id},
      ${scope},
      ${hash},
      ${record.content},
      ${sql.unsafe(vectorToPgLiteral(record.vector) + "::" + vectorCast)},
      ${record.tagsVector ? sql.unsafe(vectorToPgLiteral(record.tagsVector) + "::" + vectorCast) : null},
      ${record.containerTag},
      ${record.tags ?? null},
      ${record.type ?? null},
      ${record.createdAt},
      ${record.updatedAt},
      ${JSON.stringify(metadata)}::jsonb,
      ${record.displayName ?? null},
      ${record.userName ?? null},
      ${record.userEmail ?? null},
      ${record.projectPath ?? null},
      ${record.projectName ?? null},
      ${record.gitRepoUrl ?? null},
      ${false}
    )
    ON CONFLICT (id) DO NOTHING
  `;
}
```

**Important:** The vector literal is constructed from validated `Float32Array` data and cast using a validated type string generated from config. No user-provided strings are interpolated into SQL.

#### Search (candidate-union strategy):

```typescript
async search(options: MemorySearchOptions): Promise<SearchResult[]> {
  const sql = getPostgresClient();
  const dims = CONFIG.embeddingDimensions; // 1024
  const vectorCast = getVectorCast(CONFIG.postgres!.vectorType!, dims);
  const candidateLimit = Math.max(options.limit * 4, 50);
  const queryLiteral = vectorToPgLiteral(options.queryVector);

  // Optionally set hnsw.ef_search inside transaction
  const efSearch = CONFIG.postgres?.hnswEfSearch;

  const rows = await (efSearch
    ? sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL hnsw.ef_search = ${efSearch}`);
        return searchQuery(tx, options, queryLiteral, vectorCast, candidateLimit);
      })
    : searchQuery(sql, options, queryLiteral, vectorCast, candidateLimit));

  // TypeScript scoring (preserves current formula exactly)
  return computeWeightedScores(rows, options.queryText, options.similarityThreshold, options.limit);
}

async function searchQuery(sql, options, queryLiteral, vectorCast, candidateLimit) {
  return sql.unsafe(`
    WITH candidates AS (
      (
        SELECT id
        FROM memories
        WHERE scope = $2
          AND ($3::text = '' OR scope_hash = $3)
          AND ($4::text = '' OR container_tag = $4)
        ORDER BY vector <=> $1::${vectorCast}
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
        ORDER BY tags_vector <=> $1::${vectorCast}
        LIMIT $5
      )
    )
    SELECT
      m.*,
      1 - (m.vector <=> $1::${vectorCast}) AS content_sim,
      CASE
        WHEN m.tags_vector IS NULL THEN 0
        ELSE 1 - (m.tags_vector <=> $1::${vectorCast})
      END AS tags_sim
    FROM memories m
    JOIN candidates c ON c.id = m.id
  `, [
    queryLiteral,
    options.scope,
    options.scopeHash,
    options.includeAllContainers ? "" : options.containerTag,
    candidateLimit,
  ]);
}

function computeWeightedScores(rows, queryText, threshold, limit): SearchResult[] {
  const queryWords = queryText
    ? queryText.toLowerCase().split(/[\s,]+/).filter(w => w.length > 1)
    : [];

  const results = rows.map((row: any) => {
    const contentSim = Number(row.content_sim);
    const tagsSim = Number(row.tags_sim);
    const memoryTagsStr = row.tags || "";
    const memoryTags = memoryTagsStr.split(",").map((t: string) => t.trim().toLowerCase());

    let exactMatchBoost = 0;
    if (queryWords.length > 0 && memoryTags.length > 0) {
      const matches = queryWords.filter(w =>
        memoryTags.some(t => t.includes(w) || w.includes(t))
      ).length;
      exactMatchBoost = matches / Math.max(queryWords.length, 1);
    }

    const finalTagsSim = Math.max(tagsSim, exactMatchBoost);
    const similarity = contentSim * 0.6 + finalTagsSim * 0.4;

    return {
      id: row.id,
      memory: row.content,
      similarity,
      tags: memoryTagsStr ? memoryTagsStr.split(",") : [],
      metadata: row.metadata,
      containerTag: row.container_tag,
      displayName: row.display_name,
      userName: row.user_name,
      userEmail: row.user_email,
      projectPath: row.project_path,
      projectName: row.project_name,
      gitRepoUrl: row.git_repo_url,
      isPinned: row.is_pinned,
    };
  });

  results.sort((a, b) => b.similarity - a.similarity);
  return results.filter(r => r.similarity >= threshold).slice(0, limit);
}
```

#### Other methods:

- **delete:** `DELETE FROM memories WHERE id = ${id} RETURNING id` → return boolean.
- **getById:** `SELECT * FROM memories WHERE id = ${id}` → map row.
- **list:** `SELECT * FROM memories WHERE scope = ${scope} AND ($scopeHash = '' OR scope_hash = ${scopeHash}) AND ($containerTag = '' OR container_tag = ${containerTag}) ORDER BY created_at DESC LIMIT ${limit}`.
- **getBySessionId:** `SELECT * FROM memories WHERE session_id = ${sessionId} AND scope = ${scope} AND ($scopeHash = '' OR scope_hash = ${scopeHash}) ORDER BY created_at DESC LIMIT ${limit}`.
- **count:** `SELECT COUNT(*) as count FROM memories WHERE ...`.
- **getDistinctTags:** `SELECT DISTINCT container_tag, display_name, user_name, user_email, project_path, project_name, git_repo_url FROM memories WHERE ...`.
- **pin/unpin:** `UPDATE memories SET is_pinned = true/false WHERE id = ${id}`.

### 3.18 `src/services/storage/postgres/prompt-repository.ts` (new)

Maps `UserPromptRepository` to Postgres `user_prompts` table.

Key differences from SQLite:
- `captured` is `SMALLINT` (0/1/2), same as SQLite.
- `claimPrompt()` uses `UPDATE user_prompts SET captured = 2 WHERE id = $id AND captured = 0 RETURNING id` (atomic).
- All metadata fields (tool calls, content blocks) stored as `JSONB` not text.

### 3.19 `src/services/storage/postgres/profile-repository.ts` (new)

Maps `UserProfileRepository` to Postgres `user_profiles` and `user_profile_changelogs` tables.

Key differences:
- `profile_data` is `JSONB` not `TEXT`. Store with `::jsonb` cast.
- `is_active` is proper `BOOLEAN`.

### 3.20 `src/services/storage/postgres/ai-session-repository.ts` (new)

Maps `AISessionRepository` to Postgres `ai_sessions` and `ai_messages` tables.

Key differences:
- `metadata`, `tool_calls`, `content_blocks` are `JSONB`.
- Message sequencing uses `SELECT ... FOR UPDATE` transaction pattern:
  ```sql
  BEGIN;
  SELECT id FROM ai_sessions WHERE id = $1 FOR UPDATE;
  SELECT COALESCE(MAX(sequence), -1) + 1 FROM ai_messages WHERE ai_session_id = $1;
  INSERT INTO ai_messages (...) VALUES (...);
  COMMIT;
  ```
- Or rely on single-process assumption with unique constraint retry.

### 3.21 `src/services/storage/postgres/sqlite-importer.ts` (new)

Migration tool. Algorithm:

1. **Initialize Postgres schema:** Run migrations.
2. **Discover SQLite shards:** Open `metadata.db`, read `shards` table.
3. **Migrate memories (per shard):**
   - Open shard DB.
   - `SELECT * FROM memories`.
   - For each row:
     - Decode `vector` blob → `Float32Array` via `decodeSqliteVectorBlob()`.
     - Decode `tags_vector` blob → `Float32Array | null`.
     - Assert dimensions === `CONFIG.embeddingDimensions` (1024).
     - Parse `metadata` text → JSON object, normalize session keys to `sessionID`.
     - Convert `is_pinned` integer to boolean.
     - Derive `scope` and `scope_hash` from `container_tag`.
     - Insert into Postgres `memories` table.
   - Batch inserts (e.g., 500 rows per batch).
   - `ON CONFLICT (id) DO NOTHING` by default.
4. **Migrate user prompts:** Open `user-prompts.db`, read all rows, insert.
5. **Migrate user profiles:** Open `user-profiles.db`, read profiles and changelogs, insert.
6. **Migrate AI sessions:** Open `ai-sessions.db`, read sessions and messages, insert.
   - **Preflight:** Check for duplicate `(ai_session_id, sequence)` pairs in source data.
   - Report or resolve duplicates before inserting with the unique constraint.
7. **Verify counts:** Compare source and destination row counts per table.
8. **Report:** Summary with counts, errors, warnings.

Controlled concurrency: Process at most `maxConnections - 2` shards in parallel, keeping connections for queries.

CLI flags:
- `--dry-run`: Validate and count without writing.
- `--batch-size`: Insert batch size (default 500).
- `--overwrite`: Use `ON CONFLICT (id) DO UPDATE` instead of `DO NOTHING`.

### 3.22 `src/index.ts`

**Changes:**
1. `shutdownHandler`: `await memoryClient.close()` instead of synchronous `memoryClient.close()`.
2. Remove direct import of `connectionManager` for checkpointing in idle handler (delegate to repository).
3. In idle event handler, replace `connectionManager.checkpointAll()` with repository-level flush (no-op for Postgres, WAL checkpoint for SQLite).

### 3.23 `package.json`

**Changes:**
1. Add `"postgres": "^3.4"` to `dependencies`.
2. Optionally add `"migrate:postgres"` script pointing to `scripts/migrate-to-postgres.ts`.

---

## 4. Async Conversion Sequence

The most critical and risk-bearing aspect is the sync-to-async conversion. SQLite calls are synchronous; Postgres calls are asynchronous.

### Phase 1: Repository interface introduction (PR 2)

1. Define all repository interfaces with `async` methods.
2. SQLite repository wrappers call synchronous SQLite methods but are declared `async`.
3. TypeScript compiler ensures callers `await` repository methods.
4. Callers that are currently synchronous must become `async`:
   - `UserPromptManager.savePrompt()` → must be awaited.
   - `UserPromptManager.getPromptById()` → must be awaited.
   - `UserProfileManager.getActiveProfile()` → must be awaited.
   - etc.

### Phase 2: Caller conversion

Files that must handle async conversion:

| File | Current pattern | Required change |
|---|---|---|
| `src/services/client.ts` | `vectorSearch.insertVector()` inside `async` method | Already async; just change call target |
| `src/services/api-handlers.ts` | `shardManager.*()`, `vectorSearch.*()`, `connectionManager.*()` | Already in `async` handlers; add `await` |
| `src/services/cleanup-service.ts` | `db.prepare().all()`, `vectorSearch.deleteVector()` | Already in `async` method; add `await` |
| `src/services/deduplication-service.ts` | `vectorSearch.getAllMemories()`, `vectorSearch.deleteVector()` | Already in `async` method; add `await` |
| `src/services/auto-capture.ts` | `userPromptManager.savePrompt()` | Add `await`; currently sync call |
| `src/services/user-memory-learning.ts` | `userPromptManager.*()`, `userProfileManager.*()` | Add `await`; currently sync calls |
| `src/index.ts` | `userPromptManager.savePrompt()` in `chat.message` hook | Add `await`; already in async handler |
| `src/index.ts` | `memoryClient.close()` in shutdown | Change to `await memoryClient.close()` |

### Phase 3: Validate no sync methods remain

After all callers are converted:
1. `bun run typecheck` should pass with no errors about missing `await`.
2. Grep for any remaining direct imports of `shardManager`, `connectionManager`, `vectorSearch` from outside `src/services/storage/` and `src/services/sqlite/`.

---

## 5. Migration / Schema Tasks

### 5.1 Schema creation order

1. `schema_migrations` table.
2. `CREATE EXTENSION IF NOT EXISTS vector`.
3. `embedding_config` table.
4. `memories` table with `vector(1024)` and `tags_vector vector(1024)`.
5. Standard indexes on `memories`.
6. HNSW indexes on `memories.vector` and `memories.tags_vector` (optionally `CONCURRENTLY`).
7. `user_prompts` table + indexes.
8. `user_profiles` + `user_profile_changelogs` tables + indexes.
9. `ai_sessions` + `ai_messages` tables + indexes.
10. Insert active `embedding_config` row.

### 5.2 HNSW index creation strategy

- For initial empty database: `CREATE INDEX IF NOT EXISTS` inside transaction is fine.
- For post-migration data load: Drop and recreate HNSW indexes with `CREATE INDEX CONCURRENTLY` for better performance and no lock contention.
- `m = 16`, `ef_construction = 256` (configurable via `postgres.hnswEfConstruction`).
- Partial index for `tags_vector` with `WHERE tags_vector IS NOT NULL`.

### 5.3 Dimension validation

At startup when `storageBackend === "postgres"`:
1. Read active `embedding_config` row.
2. Compare `dimensions` column with `CONFIG.embeddingDimensions`.
3. If mismatch: throw clear error with both values.
4. If no active row exists: run migration to create it.

### 5.4 SQLite-to-Postgres migration steps

1. Read `metadata.db` `shards` table.
2. For each shard:
   - Open SQLite connection.
   - Read all rows from `memories` table.
   - For each row:
     - `new Float32Array(new Uint8Array(row.vector).buffer)` → content vector.
     - `row.tags_vector ? new Float32Array(new Uint8Array(row.tags_vector).buffer) : null` → tags vector.
     - `assertVectorDimensions(vector, 1024)` — if fails, log and skip row.
     - `JSON.parse(row.metadata || "{}")` → normalize `session_id`/`sessionId` keys to `sessionID`.
     - `row.is_pinned === 1` → boolean.
     - Derive `scope` and `scope_hash` from `container_tag` using `extractScopeFromContainerTag()`.
   - Batch insert into Postgres.
3. Migrate `user-prompts.db`:
   - Read all rows, map to Postgres schema.
   - `captured` stays as SMALLINT (0/1/2).
   - `user_learning_captured` stays as BOOLEAN.
4. Migrate `user-profiles.db`:
   - Read `user_profiles` rows. `profile_data` TEXT → JSONB.
   - Read `user_profile_changelogs` rows. `profile_data_snapshot` TEXT → JSONB.
5. Migrate `ai-sessions.db`:
   - **Preflight check:** `SELECT ai_session_id, sequence, COUNT(*) FROM ai_messages GROUP BY ai_session_id, sequence HAVING COUNT(*) > 1`.
   - If duplicates found: report them, optionally re-sequence deterministically.
   - Read `ai_sessions` rows. `metadata` TEXT → JSONB.
   - Read `ai_messages` rows. `tool_calls`, `content_blocks` TEXT → JSONB.
6. Count verification:
   - Compare source shard memory count vs Postgres `SELECT COUNT(*) FROM memories`.
   - Same for prompts, profiles, sessions, messages.
7. Report summary.

---

## 6. Tests and Validation

### 6.1 Unit tests

| Test | File | What it verifies |
|---|---|---|
| `vectorToPgLiteral` | `tests/storage/postgres-vector-utils.test.ts` | Correct `[0.1,0.2,...]` format |
| `assertVectorDimensions` | `tests/storage/postgres-vector-utils.test.ts` | Throws on wrong dimension, passes on correct |
| `decodeSqliteVectorBlob` | `tests/storage/postgres-vector-utils.test.ts` | Round-trip Float32Array → blob → Float32Array |
| `getVectorCast` | `tests/storage/postgres-vector-utils.test.ts` | Returns `"vector(1024)"` or `"halfvec(1024)"`, rejects invalid |
| `redactDatabaseUrl` | `tests/storage/postgres-vector-utils.test.ts` | Password hidden |
| Config resolution | `tests/config-postgres.test.ts` | `storageBackend`, `postgres.*`, `embeddingMaxTokens` parsed correctly |
| Embedding truncation | `tests/embedding-truncation.test.ts` | Right-truncation keeps beginning, left-truncation keeps end, cache differentiates |
| Repository factory | `tests/storage/factory.test.ts` | Returns correct implementation for each backend |

### 6.2 Contract tests (shared suites)

Each contract test suite defines a standard set of operations and can be run against any implementation.

**`tests/storage/memory-repository.contract.ts`:**
- insert → getById returns matching row
- insert → list returns the row
- insert → search by content vector returns ranked results
- insert with tags → tags_vector search returns ranked results
- insert → delete → getById returns null
- search respects similarity threshold
- search applies weighted scoring (0.6 content + 0.4 tags)
- search applies exact tag boost
- all-projects search (empty scopeHash) returns across scopes
- getBySessionId returns session-linked memories
- count returns correct totals
- getDistinctTags returns unique tags
- pin/unpin toggle
- update preserves fields

**`tests/storage/user-prompt-repository.contract.ts`:**
- savePrompt → getLastUncapturedPrompt returns it
- claimPrompt atomic: second claim returns false
- markAsCaptured
- markMultipleAsCaptured
- countUncapturedPrompts
- getPromptsForUserLearning / markAsUserLearningCaptured
- deleteOldPrompts returns linked memory IDs
- linkMemoryToPrompt
- searchPrompts

**`tests/storage/user-profile-repository.contract.ts`:**
- createProfile → getActiveProfile returns it
- updateProfile increments version and adds changelog
- getProfileChangelogs returns history
- applyConfidenceDecay reduces old preference confidence
- deleteProfile

**`tests/storage/ai-session-repository.contract.ts`:**
- createSession → getSession returns it
- updateSession updates conversationId/metadata
- addMessage / getMessages returns ordered messages
- getLastSequence increments
- cleanupExpiredSessions removes old sessions
- clearMessages

### 6.3 Postgres integration tests

**`tests/storage/postgres-migrations.test.ts`:**
- Clean DB → run migrations → verify all tables exist
- Verify `vector` extension is installed
- Verify HNSW indexes exist
- Verify `embedding_config` has active row
- Run migrations again → idempotent (no errors)

**`tests/storage/postgres-memory-repository.test.ts`:**
- Insert 10 deterministic vectors
- Search returns expected cosine ordering
- Verify query plan uses HNSW index (optional `EXPLAIN ANALYZE`)
- JSONB metadata queries work
- Session ID generated column works

### 6.4 Migration tests

**`tests/storage/sqlite-to-postgres-migration.test.ts`:**
- Create fixture SQLite shards with known data
- Run importer
- Verify row counts match
- Verify vector integrity (cosine similarity between source and destination > 0.999)
- Run importer again → idempotent (no duplicate rows)
- Dimension mismatch detection (768 vs 1024) → error reported
- Corrupt shard handling → graceful error, other shards still imported

### 6.5 Test infrastructure

- **Docker Compose** with `pgvector/pgvector:pg16` for integration tests.
- **Environment variable** `OPENCODE_MEM_TEST_DATABASE_URL` for CI.
- **Test helper** that creates/drops a test schema per test run.

---

## 7. Rollback Checkpoints

### After PR 1 (Config + Embedding)

- Revert `config.ts` and `embedding.ts` changes.
- No storage changes; SQLite fully operational.
- Existing config files without new keys continue to work.

### After PR 2 (Storage Interfaces)

- Revert all files. SQLite managers are untouched; only callers changed.
- If `client.ts` changes broke something, revert to direct SQLite usage.

### After PR 3 (Postgres Client + Schema)

- Postgres client is not used at runtime (factory still returns SQLite).
- Revert by removing `postgres` dependency and `src/services/storage/postgres/` directory.

### After PR 4 (Postgres Memory Repository)

- Set `storageBackend: "sqlite"` in config to immediately revert.
- SQLite data is untouched.
- Postgres schema can be dropped with `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` (if needed).

### After PR 5 (Full Postgres Repositories)

- Same as PR 4: switch config back to `sqlite`.

### After PR 6 (Migration Tool)

- SQLite source files are NOT deleted by migration.
- Switching back to `sqlite` in config resumes SQLite usage.
- **Warning:** Any new memories written to Postgres after migration will NOT be in SQLite.
- Document clearly: "Postgres-only writes after cutover will not appear in SQLite if you roll back."

### General rollback strategy

1. **Config rollback:** Change `storageBackend` back to `"sqlite"`.
2. **Code rollback:** Revert to previous package version.
3. **Data rollback:** Not automatic. SQLite data is preserved. Postgres data is separate.
4. **Schema rollback:** Postgres migrations are additive; no down-migrations needed for rollback. Drop and recreate if necessary.

---

## 8. Risk Notes

### 8.1 Sync-to-Async Conversion

**Risk:** Many call sites currently make synchronous SQLite calls. Converting to async requires careful `await` propagation.

**Mitigation:**
- TypeScript compiler will flag missing `await` on `Promise` return types.
- SQLite repository wrappers are `async` from day one, so callers must `await` immediately.
- Test exhaustively after PR 2 before proceeding.

### 8.2 Search Ranking Parity

**Risk:** pgvector cosine distance may produce slightly different numerical results than TypeScript cosine similarity used by `ExactScanBackend` or `usearch`.

**Mitigation:**
- Keep final weighted scoring in TypeScript (same formula: `contentSim * 0.6 + finalTagsSim * 0.4`).
- pgvector is only used for candidate retrieval; final scores are computed identically.
- Add parity tests with deterministic vectors.

### 8.3 Vector Dimension Mismatch

**Risk:** Existing SQLite shards may contain vectors from a different embedding model (e.g., 768 dimensions from `Xenova/nomic-embed-text-v1`) while Postgres schema expects `vector(1024)`.

**Mitigation:**
- Migration tool validates dimensions before insertion.
- Startup validation checks `embedding_config` against `CONFIG.embeddingDimensions`.
- Clear error messages with both expected and actual dimensions.

### 8.4 Connection String Leakage

**Risk:** Postgres URL contains credentials that could appear in logs or error messages.

**Mitigation:**
- `redactDatabaseUrl()` function used in all log statements.
- Error handlers strip connection strings before logging.
- Config resolution uses `resolveSecretValue()` for `postgres.url`.

### 8.5 HNSW Index Build Performance

**Risk:** Building HNSW indexes on a large `memories` table can be slow and lock the table.

**Mitigation:**
- Use `CREATE INDEX CONCURRENTLY` for production post-load builds.
- Migration tool can optionally defer HNSW index creation until after bulk import.
- `ef_construction = 256` is a good balance; higher values improve recall but slow builds.

### 8.6 JSONB Metadata Import

**Risk:** SQLite stores metadata as TEXT. If metadata contains invalid JSON, Postgres JSONB insertion will fail.

**Mitigation:**
- Parse metadata text with `JSON.parse()` before insertion.
- If parse fails, store `{}` and log a warning with the memory ID.
- Validate with `jsonb_typeof(metadata) = 'object'` after import.

### 8.7 AI Message Duplicate Sequences

**Risk:** SQLite does not enforce `UNIQUE(ai_session_id, sequence)`. Existing data may have duplicates that block Postgres unique constraint.

**Mitigation:**
- Migration tool runs preflight check for duplicate sequences.
- If found, report duplicates and offer deterministic resolution (keep highest ID, re-sequence).
- Document the issue and resolution in migration output.

### 8.8 Bun TLS with Remote Postgres

**Risk:** Bun's TLS implementation may differ from Node.js when connecting to hosted Postgres providers.

**Mitigation:**
- Test against target provider early in development.
- Use `ssl: "require"` by default.
- Document CA/SNI troubleshooting steps.
- Provide config option `postgres.ssl: false` for local development only.

### 8.9 Foreign Key Behavior Differences

**Risk:** Postgres enforces foreign keys strictly; SQLite may not (depending on `PRAGMA foreign_keys`).

**Mitigation:**
- `user_prompts.linked_memory_id REFERENCES memories(id) ON DELETE SET NULL` — deleting a memory nulls the reference.
- Current SQLite code does not cascade delete to prompts; Postgres behavior matches intent.
- Update tests to expect `linkedMemoryId: null` after memory deletion.

### 8.10 Query Plan Regression

**Risk:** Complex search CTE with UNION may not use HNSW indexes efficiently for all parameter combinations.

**Mitigation:**
- Test with `EXPLAIN ANALYZE` on realistic data sizes.
- Ensure `($3::text = '' OR scope_hash = $3)` does not prevent index usage (may need `OR`-rewrite).
- Consider alternative: two separate queries with TypeScript merge if CTE causes issues.

### 8.11 Connection Pool Exhaustion

**Risk:** Under high concurrency, connection pool may be exhausted.

**Mitigation:**
- Default `maxConnections: 10` with configurable override.
- Migration tool uses controlled concurrency (process 2–3 shards simultaneously, not all).
- Query batching reduces per-operation connection usage.

### 8.12 Transaction Semantics

**Risk:** `postgres.js` transaction behavior differs from SQLite's autocommit-per-statement model.

**Mitigation:**
- Explicit `sql.begin()` for multi-statement operations.
- `ON CONFLICT DO NOTHING` for idempotent inserts.
- No implicit transaction assumptions.

---

## Summary of Vector Column Declarations

Both vector columns in the `memories` table use the same dimension:

| Column | Type | Dimension | Notes |
|---|---|---:|---|
| `vector` | `vector(1024)` | 1024 | Content embedding. NOT NULL. HNSW index. |
| `tags_vector` | `vector(1024)` | 1024 | Tags embedding. Nullable. Partial HNSW index where not null. |

The `embeddingMaxTokens` config (`content: 2048`, `tags: 256`, `query: 512`, `migration: 2048`) controls **input text truncation** only — how many tokens of input text are sent to the embedding model. The embedding model always outputs 1024-dimensional vectors regardless of input length. Do NOT truncate the `Float32Array` output or declare `tags_vector vector(512)`.
