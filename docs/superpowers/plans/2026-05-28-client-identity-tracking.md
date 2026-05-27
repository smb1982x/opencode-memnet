# Client Identity Tracking & Connection Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unique client IDs, server-side client tracking, connection lifecycle logging (first-time greeting, welcome-back after N days), client nicknaming, and welcome-back toast with stats on OpenCode startup.

**Architecture:** Plugin generates a UUID on first load and persists it locally. On every request it sends an `X-Client-ID` header. Server upserts into a new `clients` DB table, detects first-time vs returning clients, and logs lifecycle events. A new `/api/client/connect` endpoint returns connection metadata and stats. Plugin shows a welcome toast on startup using this data.

**Tech Stack:** PostgreSQL (new migration), Bun/TypeScript server, OpenCode plugin SDK (toast API)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/services/storage/postgres/client-repository.ts` | CRUD for `clients` table |
| Modify | `src/services/storage/postgres/migrations.ts` | Add migration 12 (clients table) |
| Modify | `src/services/storage/types.ts` | Add `ClientRepository` interface + `ClientRow` type |
| Modify | `src/services/storage/factory.ts` | Add `createClientRepository()` + lazy proxy |
| Modify | `src/server-config.ts` | Add `clientWelcomeBackThreshold` + `parseDurationString` |
| Modify | `src/services/api-handlers.ts` | Add `handleClientConnect`, `handleSetClientNickname`, `handleGetClientStats` |
| Modify | `src/services/web-server.ts` | Add 3 new routes + extract `X-Client-ID` header for logging |
| Create | `plugin/src/client-identity.ts` | Generate/persist UUID, read metadata |
| Modify | `plugin/src/services/remote-client.ts` | Send `X-Client-ID` header + 3 new API methods |
| Modify | `plugin/src/index-remote.ts` | Call connect on init, show welcome toast |
| Modify | `.env.example` | Document `CLIENT_WELCOME_BACK_THRESHOLD` |
| Modify | `docker-compose.yml` | Pass `CLIENT_WELCOME_BACK_THRESHOLD` |
| Modify | `docker-compose.external-db.yml` | Pass `CLIENT_WELCOME_BACK_THRESHOLD` |
| Modify | `src/services/logger.ts` | (no changes needed — already has leveled logging) |

---

## Task 1: Add Duration Parser + Config Field

**Files:**
- Modify: `src/server-config.ts:4-55` (interface)
- Modify: `src/server-config.ts:129-144` (initServerConfig)

- [ ] **Step 1: Add `parseDurationString` function and config field to server-config.ts**

Add at the top of `src/server-config.ts`, after the imports (line 2):

```typescript
/**
 * Parse a duration string like "24h", "7d", "1w" into hours.
 * Returns 0 for unparseable values.
 */
export function parseDurationString(input: string): number {
  const match = input.match(/^(\d+)(h|d|w)$/);
  if (!match) return 0;
  const n = parseInt(match[1]);
  switch (match[2]) {
    case "h": return n;
    case "d": return n * 24;
    case "w": return n * 24 * 7;
    default: return 0;
  }
}
```

Add to `ServerConfig` interface (after `logLevel` field, around line 55):

```typescript
  clientWelcomeBackThreshold: number; // in hours
```

Add to `initServerConfig()` return object (after the `logLevel` field, around line 143):

```typescript
    clientWelcomeBackThreshold: parseDurationString(env.CLIENT_WELCOME_BACK_THRESHOLD || "7d"),
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/server-config.ts
git commit -m "feat: add parseDurationString and clientWelcomeBackThreshold config"
```

---

## Task 2: Add Types for Client Repository

**Files:**
- Modify: `src/services/storage/types.ts` (end of file, before last export)

- [ ] **Step 1: Add client-related types to types.ts**

Append to `src/services/storage/types.ts` (before the final closing of the file):

```typescript
// ── Client tracking types ──

export interface ClientRow {
  id: string;
  nickname: string | null;
  firstSeen: number;  // unix epoch ms
  lastSeen: number;   // unix epoch ms
  clientMetadata: Record<string, unknown>;
  createdAt: number;  // unix epoch ms
  updatedAt: number;  // unix epoch ms
}

export interface ClientRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  upsertClient(id: string, metadata: Record<string, unknown>): Promise<{ firstTime: boolean; previousLastSeen: number | null; row: ClientRow }>;
  setNickname(id: string, nickname: string): Promise<ClientRow | null>;
  getClient(id: string): Promise<ClientRow | null>;
  getClientStats(id: string): Promise<{
    client: ClientRow | null;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }>;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/services/storage/types.ts
git commit -m "feat: add ClientRepository interface and ClientRow type"
```

---

## Task 3: Add Migration 12 (clients table)

**Files:**
- Modify: `src/services/storage/postgres/migrations.ts:340-345` (MIGRATIONS array)

- [ ] **Step 1: Add migration 12 to the MIGRATIONS array**

Add before the closing `]` of the `MIGRATIONS` array (currently the last entry is version 11 around line 340):

```typescript
  {
    version: 12,
    description: "Create clients table for client identity tracking",
    transactional: true,
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS clients (
          id TEXT PRIMARY KEY,
          nickname TEXT,
          first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
          client_metadata JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_clients_last_seen ON clients (last_seen)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_clients_nickname ON clients (nickname) WHERE nickname IS NOT NULL`;
    },
  },
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/services/storage/postgres/migrations.ts
git commit -m "feat: add migration 12 — clients table for identity tracking"
```

---

## Task 4: Create Client Repository

**Files:**
- Create: `src/services/storage/postgres/client-repository.ts`

- [ ] **Step 1: Create the client repository implementation**

Create `src/services/storage/postgres/client-repository.ts`:

```typescript
// src/services/storage/postgres/client-repository.ts
import type { SqlClient } from "./migrations.js";
import { getPostgresClient, closePostgresClient } from "./client.js";
import type { ClientRepository, ClientRow } from "../types.js";
import { log, logDebug } from "../../logger.js";

export class PostgresClientRepository implements ClientRepository {
  private getClient(): SqlClient {
    return getPostgresClient();
  }

  async initialize(): Promise<void> {
    // Migrations handle table creation
    logDebug("[client-repository] initialized");
  }

  async close(): Promise<void> {
    // Connection pool is shared — don't close here
  }

  private mapRow(row: any): ClientRow {
    return {
      id: row.id,
      nickname: row.nickname,
      firstSeen: new Date(row.first_seen).getTime(),
      lastSeen: new Date(row.last_seen).getTime(),
      clientMetadata: row.client_metadata ?? {},
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  async upsertClient(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<{ firstTime: boolean; previousLastSeen: number | null; row: ClientRow }> {
    const sql = this.getClient();

    // Check if client exists first to detect first-time vs returning
    const existing = await sql`SELECT * FROM clients WHERE id = ${id}`;
    let firstTime = false;
    let previousLastSeen: number | null = null;

    if (existing.length > 0) {
      previousLastSeen = new Date(existing[0].last_seen).getTime();
    } else {
      firstTime = true;
    }

    const rows = await sql`
      INSERT INTO clients (id, nickname, first_seen, last_seen, client_metadata, created_at, updated_at)
      VALUES (${id}, NULL, now(), now(), ${metadata}, now(), now())
      ON CONFLICT (id) DO UPDATE SET
        last_seen = now(),
        client_metadata = ${metadata},
        updated_at = now()
      RETURNING *
    `;

    return {
      firstTime,
      previousLastSeen,
      row: this.mapRow(rows[0]),
    };
  }

  async setNickname(id: string, nickname: string): Promise<ClientRow | null> {
    const sql = this.getClient();
    const rows = await sql`
      UPDATE clients SET nickname = ${nickname}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async getClient(id: string): Promise<ClientRow | null> {
    const sql = this.getClient();
    const rows = await sql`SELECT * FROM clients WHERE id = ${id}`;
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async getClientStats(id: string): Promise<{
    client: ClientRow | null;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }> {
    const sql = this.getClient();
    const clientRow = await this.getClient(id);

    // Count total memories
    const memResult = await sql`SELECT COUNT(*) as count FROM memories`;
    const totalMemories = parseInt(memResult[0]?.count ?? "0");

    // Count memories created today
    const todayResult = await sql`
      SELECT COUNT(*) as count FROM memories
      WHERE created_at >= CURRENT_DATE
    `;
    const memoriesToday = parseInt(todayResult[0]?.count ?? "0");

    // Count total prompts
    const promptResult = await sql`SELECT COUNT(*) as count FROM user_prompts`;
    const totalPrompts = parseInt(promptResult[0]?.count ?? "0");

    return {
      client: clientRow,
      totalMemories,
      memoriesToday,
      totalPrompts,
    };
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/services/storage/postgres/client-repository.ts
git commit -m "feat: add PostgresClientRepository for client identity CRUD"
```

---

## Task 5: Register Client Repository in Factory

**Files:**
- Modify: `src/services/storage/factory.ts:10-27` (imports)
- Modify: `src/services/storage/factory.ts:31-58` (singletons)
- Modify: `src/services/storage/factory.ts:63-90` (initializeStorage + closeStorage)

- [ ] **Step 1: Add ClientRepository to imports**

Add `ClientRepository` to the import from `"./types.js"` (line 10-27):

```typescript
  ClientRepository,
```

- [ ] **Step 2: Add client repo singleton + factory function**

After line 34 (`let sessionRepo`), add:

```typescript
let clientRepo: ClientRepository | null = null;
```

After the `createAISessionRepository` function (after line 57), add:

```typescript
export function createClientRepository(): ClientRepository {
  if (clientRepo) return clientRepo;
  clientRepo = new PostgresClientRepositoryLazy();
  return clientRepo;
}
```

- [ ] **Step 3: Add the lazy proxy class**

Before the `PostgresMemoryRepositoryLazy` class OR at the end of the file (after `PostgresAISessionRepositoryLazy`), add:

```typescript
class PostgresClientRepositoryLazy implements ClientRepository {
  private target: Promise<ClientRepository> | null = null;
  private async repo(): Promise<ClientRepository> {
    if (!this.target) {
      this.target = import("./postgres/client-repository.js")
        .then(({ PostgresClientRepository }) => new PostgresClientRepository());
    }
    return this.target;
  }
  async initialize(): Promise<void> { await (await this.repo()).initialize(); }
  async close(): Promise<void> { await (await this.repo()).close(); }
  async upsertClient(id: string, metadata: Record<string, unknown>) {
    return (await this.repo()).upsertClient(id, metadata);
  }
  async setNickname(id: string, nickname: string) {
    return (await this.repo()).setNickname(id, nickname);
  }
  async getClient(id: string) {
    return (await this.repo()).getClient(id);
  }
  async getClientStats(id: string) {
    return (await this.repo()).getClientStats(id);
  }
}
```

- [ ] **Step 4: Add to initializeStorage() and closeStorage()**

In `initializeStorage()` (around line 63-79), add client repo initialization alongside the others:

```typescript
  const client = createClientRepository();
```

Add `await client.initialize();` alongside the other `await` calls.

Update the return type to include `clientRepo: ClientRepository`.

In `closeStorage()` (around line 90-100), add:

```typescript
  if (clientRepo) await clientRepo.close().catch(() => {});
```

- [ ] **Step 5: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/services/storage/factory.ts
git commit -m "feat: register ClientRepository in storage factory"
```

---

## Task 6: Add Client API Handlers

**Files:**
- Modify: `src/services/api-handlers.ts` (add at end of file, before last functions)

- [ ] **Step 1: Add client repo import and init**

At the top of `api-handlers.ts`, add to the factory imports (around line 15):

```typescript
  createClientRepository,
```

Add type import:

```typescript
import type { ClientRepository } from "./storage/types.js";
```

Add singleton alongside existing repos (after the existing repo declarations):

```typescript
let clientRepo: ClientRepository | null = null;
```

In `ensureInit()`, add:

```typescript
      clientRepo = createClientRepository();
      await clientRepo.initialize();
```

- [ ] **Step 2: Add `handleClientConnect` handler**

```typescript
export async function handleClientConnect(data: {
  clientId: string;
  metadata?: Record<string, unknown>;
}): Promise<
  ApiResponse<{
    firstTime: boolean;
    daysSinceLastSeen: number | null;
    nickname: string | null;
    welcomeBack: boolean;
    stats: { totalMemories: number; memoriesToday: number; totalPrompts: number } | null;
  }>
> {
  try {
    if (!data.clientId) {
      return { success: false, error: "clientId is required" };
    }
    await ensureInit();

    const metadata = data.metadata ?? {};
    const result = await clientRepo!.upsertClient(data.clientId, metadata);
    const thresholdHours = getServerConfig().clientWelcomeBackThreshold;

    let daysSinceLastSeen: number | null = null;
    let welcomeBack = false;

    if (result.previousLastSeen && thresholdHours > 0) {
      const hoursSince = (Date.now() - result.previousLastSeen) / (1000 * 60 * 60);
      daysSinceLastSeen = Math.round(hoursSince / 24);
      if (hoursSince >= thresholdHours) {
        welcomeBack = true;
      }
    }

    // Log lifecycle event
    const displayName = result.row.nickname || data.clientId.slice(0, 8);
    if (result.firstTime) {
      logInfo(`🆕 New client connected: ${displayName}`, {
        clientId: data.clientId,
        metadata,
      });
    } else if (welcomeBack) {
      logInfo(`👋 Welcome back: ${displayName} (last seen ${daysSinceLastSeen}d ago)`, {
        clientId: data.clientId,
        daysSinceLastSeen,
      });
    } else {
      logDebug(`Client connected: ${displayName}`, {
        clientId: data.clientId,
        hoursSinceLast: result.previousLastSeen
          ? Math.round((Date.now() - result.previousLastSeen) / (1000 * 60 * 60))
          : null,
      });
    }

    // Get stats
    const stats = await clientRepo!.getClientStats(data.clientId);

    return {
      success: true,
      data: {
        firstTime: result.firstTime,
        daysSinceLastSeen,
        nickname: result.row.nickname,
        welcomeBack,
        stats: {
          totalMemories: stats.totalMemories,
          memoriesToday: stats.memoriesToday,
          totalPrompts: stats.totalPrompts,
        },
      },
    };
  } catch (error) {
    logError("handleClientConnect: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}
```

You'll also need to import `getServerConfig` from `"../server-config.js"` and `logInfo`, `logDebug`, `logError` from `"./logger.js"` (check if already imported — `log` is already imported, may need to add the others).

- [ ] **Step 3: Add `handleSetClientNickname` handler**

```typescript
export async function handleSetClientNickname(data: {
  clientId: string;
  nickname: string;
}): Promise<ApiResponse<{ nickname: string }>> {
  try {
    if (!data.clientId || !data.nickname) {
      return { success: false, error: "clientId and nickname are required" };
    }
    await ensureInit();

    const result = await clientRepo!.setNickname(data.clientId, data.nickname);
    if (!result) {
      return { success: false, error: "Client not found — connect first" };
    }

    logInfo(`✏️ Client renamed: ${data.nickname}`, { clientId: data.clientId });

    return { success: true, data: { nickname: result.nickname! } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
```

- [ ] **Step 4: Add `handleGetClientStats` handler**

```typescript
export async function handleGetClientStats(data: {
  clientId: string;
}): Promise<
  ApiResponse<{
    nickname: string | null;
    firstSeen: number;
    lastSeen: number;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }>
> {
  try {
    if (!data.clientId) {
      return { success: false, error: "clientId is required" };
    }
    await ensureInit();

    const stats = await clientRepo!.getClientStats(data.clientId);
    if (!stats.client) {
      return { success: false, error: "Client not found — connect first" };
    }

    return {
      success: true,
      data: {
        nickname: stats.client.nickname,
        firstSeen: stats.client.firstSeen,
        lastSeen: stats.client.lastSeen,
        totalMemories: stats.totalMemories,
        memoriesToday: stats.memoriesToday,
        totalPrompts: stats.totalPrompts,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
```

- [ ] **Step 5: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/services/api-handlers.ts
git commit -m "feat: add client connect, nickname, and stats API handlers"
```

---

## Task 7: Add Routes + X-Client-ID Header Extraction

**Files:**
- Modify: `src/services/web-server.ts:5-32` (imports)
- Modify: `src/services/web-server.ts:136-165` (handleRequest — add header extraction + routes)

- [ ] **Step 1: Add new handler imports**

Update the import from `"./api-handlers.js"` (line 6-32) to add:

```typescript
  handleClientConnect,
  handleSetClientNickname,
  handleGetClientStats,
```

- [ ] **Step 2: Extract X-Client-ID in handleRequest**

In `handleRequest()`, after the existing debug log block (around line 145), add:

```typescript
    // Extract client ID for logging context
    const clientId = req.headers.get("X-Client-ID");
```

Update the debug log to include clientId if present:

```typescript
    if (path.startsWith("/api/")) {
      const qs = url.search ? `?${url.searchParams.toString()}` : "";
      logDebug(`← ${method} ${path}${qs}`, {
        method,
        path,
        query: Object.fromEntries(url.searchParams),
        client: clientId || "unknown",
      });
    }
```

- [ ] **Step 3: Add three new routes**

Add before the static file serving section (before `// Generic static file serving` around line 399):

```typescript
      // ── Client Identity ──
      if (path === "/api/client/connect" && method === "POST") {
        const body = await this.parseBody(req);
        const result = await handleClientConnect(body);
        return this.jsonResponse(result);
      }

      if (path === "/api/client/nickname" && method === "PUT") {
        const body = await this.parseBody(req);
        const result = await handleSetClientNickname(body);
        return this.jsonResponse(result);
      }

      if (path === "/api/client/stats" && method === "GET") {
        const clientIdParam = url.searchParams.get("clientId");
        if (!clientIdParam) {
          return this.jsonResponse({ success: false, error: "clientId query parameter required" });
        }
        const result = await handleGetClientStats({ clientId: clientIdParam });
        return this.jsonResponse(result);
      }
```

Also add `X-Client-ID` to the CORS allowed headers (around line 150):

```typescript
headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Client-ID");
```

- [ ] **Step 4: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/services/web-server.ts
git commit -m "feat: add client connect/nickname/stats routes and X-Client-ID header extraction"
```

---

## Task 8: Create Plugin Client Identity Module

**Files:**
- Create: `plugin/src/client-identity.ts`

- [ ] **Step 1: Create the client identity module**

Create `plugin/src/client-identity.ts`:

```typescript
// plugin/src/client-identity.ts — Generate and persist a unique client ID
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { hostname } from "node:os";
import { platform } from "node:os";
import { logDebug } from "../../shared/logger.js";

const CLIENT_ID_FILE = join(homedir(), ".config", "opencode", "opencode-memnet-client-id");

function generateId(): string {
  // UUID v4 without crypto dependency — use randomBytes from node:crypto
  const { randomBytes } = require("node:crypto");
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function getClientId(): string {
  try {
    if (existsSync(CLIENT_ID_FILE)) {
      const id = readFileSync(CLIENT_ID_FILE, "utf-8").trim();
      if (id && id.length === 36) return id;
    }
  } catch {
    // fall through to generate
  }

  const id = generateId();
  try {
    const dir = join(homedir(), ".config", "opencode");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CLIENT_ID_FILE, id, "utf-8");
    logDebug("Generated new client ID", { clientId: id });
  } catch (err) {
    logDebug("Failed to persist client ID", { error: String(err) });
  }
  return id;
}

export function getClientMetadata(): Record<string, unknown> {
  return {
    hostname: hostname(),
    platform: platform(),
  };
}
```

Note: `require("node:crypto")` won't work in the Bun-bundled plugin. Replace with:

```typescript
import { randomUUID } from "node:crypto";
```

And simplify `generateId()` to just `return randomUUID();`.

Actually, use this simpler version:

```typescript
// plugin/src/client-identity.ts — Generate and persist a unique client ID
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { logDebug } from "../../shared/logger.js";

const CLIENT_ID_FILE = join(homedir(), ".config", "opencode", "opencode-memnet-client-id");

export function getClientId(): string {
  try {
    if (existsSync(CLIENT_ID_FILE)) {
      const id = readFileSync(CLIENT_ID_FILE, "utf-8").trim();
      if (id && id.length === 36) return id;
    }
  } catch {
    // fall through to generate
  }

  const id = randomUUID();
  try {
    const dir = join(homedir(), ".config", "opencode");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CLIENT_ID_FILE, id, "utf-8");
    logDebug("Generated new client ID", { clientId: id });
  } catch (err) {
    logDebug("Failed to persist client ID", { error: String(err) });
  }
  return id;
}

export function getClientMetadata(): Record<string, unknown> {
  return {
    hostname: hostname(),
    platform: platform(),
  };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add plugin/src/client-identity.ts
git commit -m "feat: add plugin client-identity module (UUID gen/persist)"
```

---

## Task 9: Update Plugin Remote Client (Headers + New APIs)

**Files:**
- Modify: `plugin/src/services/remote-client.ts`

- [ ] **Step 1: Add X-Client-ID header to all requests**

Add a `clientId` field to the class constructor and store it. Modify the constructor:

```typescript
  private readonly clientId: string;

  constructor(baseUrl: string, apiKey: string, clientId: string, timeout?: number) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.clientId = clientId;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
    logDebug(`RemoteMemoryClient created`, { baseUrl: this.baseUrl, timeout: this.timeout, hasApiKey: !!this.apiKey, clientId: this.clientId });
  }
```

In the `request()` method, add `X-Client-ID` to the headers:

```typescript
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Client-ID": this.clientId,
        },
```

- [ ] **Step 2: Add `clientConnect`, `setClientNickname`, `getClientStats` methods**

Add at the end of the class (before the closing `}`):

```typescript
  // ─── Client Identity ──────────────────────────────────

  async clientConnect(
    clientId: string,
    metadata: Record<string, unknown>
  ): Promise<
    ApiResponse<{
      firstTime: boolean;
      daysSinceLastSeen: number | null;
      nickname: string | null;
      welcomeBack: boolean;
      stats: { totalMemories: number; memoriesToday: number; totalPrompts: number } | null;
    }>
  > {
    return this.request("POST", "/api/client/connect", { clientId, metadata });
  }

  async setClientNickname(
    clientId: string,
    nickname: string
  ): Promise<ApiResponse<{ nickname: string }>> {
    return this.request("PUT", "/api/client/nickname", { clientId, nickname });
  }

  async getClientStats(
    clientId: string
  ): Promise<
    ApiResponse<{
      nickname: string | null;
      firstSeen: number;
      lastSeen: number;
      totalMemories: number;
      memoriesToday: number;
      totalPrompts: number;
    }>
  > {
    return this.request("GET", `/api/client/stats`, undefined, { clientId });
  }
```

- [ ] **Step 3: Update singleton creation to accept clientId**

Change the singleton section at the bottom:

```typescript
let _client: RemoteMemoryClient | null = null;

export function getRemoteClient(clientId?: string): RemoteMemoryClient {
  if (_client) return _client;
  if (!clientId) throw new Error("clientId required for first initialization");
  _client = new RemoteMemoryClient(CLIENT_CONFIG.serverUrl, CLIENT_CONFIG.apiKey, clientId);
  return _client;
}
export const remoteMemoryClient = getRemoteClient as RemoteMemoryClient;
```

Actually, since `remoteMemoryClient` is a module-level const, we can't delay it. Change the approach: remove the `export const remoteMemoryClient` line, and instead export only the `getRemoteClient()` function. The caller will pass clientId on first call.

- [ ] **Step 4: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: May have errors in index-remote.ts since we changed the export. Will fix in Task 10.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/services/remote-client.ts
git commit -m "feat: add X-Client-ID header and client connect/nickname/stats methods to plugin"
```

---

## Task 10: Update Plugin Index — Connect on Init + Welcome Toast

**Files:**
- Modify: `plugin/src/index-remote.ts`

- [ ] **Step 1: Update imports**

Replace the `remoteMemoryClient` import:

```typescript
import { getRemoteClient } from "./services/remote-client.js";
import { getClientId, getClientMetadata } from "./client-identity.js";
```

- [ ] **Step 2: Add client connect + welcome toast at plugin init**

Inside the `OpenCodeMemPlugin` function, after `const tags = ...` (around line 29-33), replace the existing `logInfo("Plugin initialized", ...)` block with:

```typescript
  const tags = await getTags(directory, TAGS_CONFIG);
  const clientId = getClientId();
  const client = getRemoteClient(clientId);

  // Connect to server — registers client and gets connection info
  let connectionInfo: Awaited<ReturnType<typeof client.clientConnect>>["data"] | null = null;
  try {
    const connectResult = await client.clientConnect(clientId, getClientMetadata());
    if (connectResult.success && connectResult.data) {
      connectionInfo = connectResult.data;
      logInfo("Plugin initialized", {
        project: tags.project.projectName || tags.project.tag,
        user: tags.user.userEmail || "unknown",
        clientId: clientId.slice(0, 8),
        firstTime: connectionInfo.firstTime,
        nickname: connectionInfo.nickname,
      });

      // Show welcome toast
      const displayName = connectionInfo.nickname || clientId.slice(0, 8);
      if (connectionInfo.firstTime) {
        ctx.client?.tui
          .showToast({
            body: {
              title: "Welcome to opencode-memnet!",
              message: `New client registered: ${displayName}`,
              variant: "info",
              duration: 4000,
            },
          })
          .catch(() => {});
      } else if (connectionInfo.welcomeBack && connectionInfo.stats) {
        const days = connectionInfo.daysSinceLastSeen;
        ctx.client?.tui
          .showToast({
            body: {
              title: `Welcome back, ${displayName}!`,
              message: `Last seen ${days}d ago | ${connectionInfo.stats.totalMemories} memories (${connectionInfo.stats.memoriesToday} today)`,
              variant: "info",
              duration: 5000,
            },
          })
          .catch(() => {});
      } else if (connectionInfo.stats) {
        ctx.client?.tui
          .showToast({
            body: {
              title: `Welcome back, ${displayName}`,
              message: `${connectionInfo.stats.totalMemories} memories | ${connectionInfo.stats.memoriesToday} new today`,
              variant: "success",
              duration: 3000,
            },
          })
          .catch(() => {});
      }
    }
  } catch (err) {
    logWarn("Failed to connect to server on init", { error: String(err) });
  }
```

- [ ] **Step 3: Replace all `remoteMemoryClient` references with `client`**

The local `const client = getRemoteClient(clientId)` is now the client instance. Replace all usages of `remoteMemoryClient` in the rest of the file with `client`.

There are references in:
- `chat.message` hook: `client.getContext(...)`
- `tool: memory`: `client.addMemory(...)`, `client.searchMemories(...)`, `client.getUserProfile(...)`, `client.listMemories(...)`, `client.deleteMemory(...)`
- `event` handler: `client.autoCapture(...)`, `client.searchMemoriesBySessionID(...)`

- [ ] **Step 4: Verify typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add plugin/src/index-remote.ts
git commit -m "feat: add client connect on plugin init with welcome toast"
```

---

## Task 11: Update Config Files

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.external-db.yml`

- [ ] **Step 1: Add to `.env.example`**

After the `DEBUG` section, add:

```
# CLIENT_WELCOME_BACK_THRESHOLD
# Duration after which a returning client gets a "welcome back" greeting.
# Format: <number><h|d|w> where h=hours, d=days, w=weeks
# Examples: 24h, 7d, 1w
# Default: 7d
# Required: no
# CLIENT_WELCOME_BACK_THRESHOLD=7d
```

- [ ] **Step 2: Add to both docker-compose files**

In the `# ── Logging ──` section (after `DEBUG`), add:

```yaml
      CLIENT_WELCOME_BACK_THRESHOLD: ${CLIENT_WELCOME_BACK_THRESHOLD:-7d}
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docker-compose.yml docker-compose.external-db.yml
git commit -m "docs: document CLIENT_WELCOME_BACK_THRESHOLD in config files"
```

---

## Task 12: Build + Verify

- [ ] **Step 1: Run typecheck**

Run: `cd /home/phrkr/Workspace/opencode-mem && bunx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -10`
Expected: Zero errors

- [ ] **Step 2: Build plugin**

Run: `cd /home/phrkr/Workspace/opencode-mem && bun run build:plugin`
Expected: Success

- [ ] **Step 3: Docker build**

Run: `cd /home/phrkr/Workspace/opencode-mem && sudo docker build --no-cache -t opencode-memnet-test .`
Expected: Success

- [ ] **Step 4: Runtime smoke test**

Run with LOG_LEVEL=debug and verify server starts and shows the new config:

```bash
sudo docker run --rm \
  -e POSTGRES_URL=postgresql://test:test@localhost:5432/test \
  -e EMBEDDING_API_URL=http://localhost \
  -e EMBEDDING_MODEL=test \
  -e EMBEDDING_API_KEY=test \
  -e SERVER_API_KEY=test \
  -e LOG_LEVEL=debug \
  opencode-memnet-test 2>&1 | head -20
```

Expected: Server starts, shows `clientWelcomeBackThreshold` in debug output, migration 12 applies.

- [ ] **Step 5: Final commit**

```bash
git push
```
