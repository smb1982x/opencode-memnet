# DESIGN: Plugin-Server Separation

## Document Metadata

- **ID**: DESIGN-PLUGIN-SEPARATION
- **Status**: Draft
- **Created**: 2026-05-26
- **Spec**: SPEC-PLUGIN-SEPARATION
- **Target Version**: 3.0.0

---

## 1. Architecture Overview

### 1.1 Current State

```
┌─────────────────────────────────────────────────┐
│                 src/ (monolith)                  │
│                                                 │
│  plugin.ts ──► index-remote.ts ──► config.ts    │
│       │            │                  │         │
│       └──► index.ts (legacy)         │         │
│                    │                  │         │
│              services/ ◄──────────────┘         │
│              ├── remote-client.ts               │
│              ├── tags.ts (imports CONFIG)       │
│              ├── logger.ts                      │
│              ├── privacy.ts                     │
│              ├── jsonc.ts                       │
│              ├── secret-resolver.ts             │
│              ├── storage/postgres/              │
│              ├── embedding.ts                   │
│              ├── ai/                            │
│              └── ...                            │
│                                                 │
│  server.ts ──► server-config.ts                 │
│                                                 │
│  Single tsc build → dist/ (everything)          │
└─────────────────────────────────────────────────┘
```

### 1.2 Target State

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   plugin/         │     │   shared/         │     │   src/            │
│                   │     │                   │     │                  │
│ src/plugin.ts ────┼────►│ client-config.ts  │◄────┼── config.ts      │
│ src/index-remote  │     │ tags.ts           │     │   server.ts      │
│ src/services/     │     │ privacy.ts        │     │   server-config  │
│   remote-client   │     │ logger.ts         │     │   services/      │
│                   │     │ jsonc.ts          │     │     storage/     │
│ package.json      │     │ secret-resolver.ts│     │     embedding   │
│ tsconfig.json     │     │ types.ts          │     │     ai/         │
│                   │     │                   │     │     ...         │
│ Bun build --bundle│     │ (no package.json) │     │                  │
│ → single .js file │     │ (imported by both)│     │ tsc → dist/     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        │                          │                        │
        │  No dependency on src/   │   No dependency on     │
        │  No server deps in       │   plugin/ or src/      │  No dependency on
        │  node_modules            │                        │  plugin/
        ▼                          ▼                        ▼
   opencode-memnet-          Pure utility              opencode-memnet-
   plugin (published)        code (no npm              server (Docker +
   OR curl|bash              deps, no I/O deps          docker-compose)
                              beyond node: builtins)
```

### 1.3 Data Flow

```
OpenCode process                      Server process
─────────────────                     ────────────────
                                      ┌─────────────────────┐
                                      │ PostgreSQL + pgvector│
                                      │ (data + vectors)     │
                                      └─────────┬───────────┘
                                                │
┌───────────────────┐    HTTP/REST    ┌──────────▼───────────┐
│  plugin/dist/      │ ──────────────►│ src/server.ts        │
│  opencode-memnet.js│ ◄──────────── │   → web-server.ts    │
│                    │    JSON        │   → api-handlers.ts  │
│  Hooks:            │                │   → storage/         │
│  • chat.message    │                │   → embedding.ts     │
│  • tool.memory     │                │   → ai/              │
│  • event(idle)     │                │   → auto-capture     │
│  • event(compacted)│                └──────────────────────┘
└───────────────────┘
        │
        │ reads config from:
        │ ~/.config/opencode/opencode-memnet.jsonc
        │ .opencode/opencode-memnet.jsonc
        │
        └── serverUrl + apiKey → HTTP Bearer auth
```

---

## 2. Directory Structure

### 2.1 Target File Tree

```
opencode-memnet/
├── shared/                              # Shared utilities — NO npm dependencies
│   ├── client-config.ts                 # Client-only config loading (from config.ts lines 630-714)
│   ├── tags.ts                          # Parameterized tag resolution (from services/tags.ts)
│   ├── privacy.ts                       # Content stripping (from services/privacy.ts) — unchanged
│   ├── logger.ts                        # File-based logging (from services/logger.ts) — unchanged
│   ├── jsonc.ts                         # JSONC parser (from services/jsonc.ts) — unchanged
│   ├── secret-resolver.ts              # Secret resolution (from services/secret-resolver.ts) — unchanged
│   └── types.ts                         # Shared type exports (from types/index.ts) — unchanged
│
├── plugin/                              # CLIENT PLUGIN — compiles independently
│   ├── package.json                     # Only @opencode-ai deps
│   ├── tsconfig.json                    # Includes src/ and ../../shared/
│   ├── build.ts                         # Bun build --bundle script
│   ├── src/
│   │   ├── plugin.ts                    # ESM entry — remote mode ONLY (~20 lines)
│   │   ├── index-remote.ts             # Remote plugin implementation (284 lines)
│   │   └── services/
│   │       └── remote-client.ts        # HTTP client for server API (239 lines)
│   └── dist/
│       └── opencode-memnet.js          # SINGLE bundled output file
│
├── src/                                 # SERVER — keeps existing structure
│   ├── server.ts                        # Standalone headless server (95 lines)
│   ├── server-config.ts                 # Server env-var config (153 lines)
│   ├── config.ts                        # Server config — client portions REMOVED (~760 lines)
│   ├── index.ts                         # @deprecated LEGACY in-process mode (kept, not shipped)
│   ├── plugin.ts                        # @deprecated original entry (kept, not shipped)
│   ├── types/
│   │   └── index.ts                     # Server-only type exports (unchanged)
│   ├── web/                             # WebUI static files (unchanged)
│   │   ├── index.html
│   │   ├── app.js
│   │   ├── styles.css
│   │   ├── i18n.js
│   │   ├── opencode-memnet-diagram.svg
│   │   └── favicon.ico
│   └── services/
│       ├── client.ts                    # LocalMemoryClient (server-only now)
│       ├── context.ts                   # Memory context formatting
│       ├── tags.ts                      # Server copy — imports CONFIG directly
│       ├── remote-client.ts            # @deprecated — kept for server reference
│       ├── logger.ts                    # Server copy — imports from shared/ OR keeps own copy
│       ├── privacy.ts                   # Server may keep copy if needed
│       ├── jsonc.ts                     # Server may keep copy if needed
│       ├── secret-resolver.ts          # Server may keep copy if needed
│       ├── embedding.ts                 # Remote embedding service
│       ├── auth.ts                      # Bearer token middleware
│       ├── health-handler.ts           # Health check endpoint
│       ├── web-server.ts               # HTTP server + API routes
│       ├── web-server-worker.ts        # Web server worker
│       ├── api-handlers.ts             # API route handlers
│       ├── auto-capture.ts             # Plugin-side auto-capture
│       ├── auto-capture-server.ts      # Server-side auto-capture
│       ├── user-memory-learning.ts     # Plugin-side profile learning
│       ├── user-profile-learner-server.ts # Server-side profile learning
│       ├── language-detector.ts        # Language detection
│       ├── tag-migration-service.ts    # Background tag migration
│       ├── user-profile/               # Profile types and utils
│       ├── ai/                         # AI provider abstraction
│       │   ├── ai-provider-factory.ts
│       │   ├── opencode-provider.ts
│       │   ├── provider-config.ts
│       │   ├── tools/tool-schema.ts
│       │   ├── validators/user-profile-validator.ts
│       │   └── providers/
│       │       ├── base-provider.ts
│       │       └── openai-chat-completion.ts
│       └── storage/                    # Storage abstraction + Postgres
│           ├── types.ts
│           ├── factory.ts
│           └── postgres/
│               ├── client.ts
│               ├── vector.ts
│               ├── migrations.ts
│               ├── memory-repository.ts
│               ├── profile-repository.ts
│               ├── ai-session-repository.ts
│               ├── prompt-repository.ts
│               ├── profile-utils.ts
│               └── tag-migration-service.ts
│
├── scripts/
│   ├── install-client.sh               # Quickstart client install (non-interactive)
│   └── install-server.sh              # Quickstart server install (non-interactive)
│
├── tests/
├── package.json                        # Root — server build + orchestration
├── tsconfig.json                       # Root — server compilation
├── Dockerfile                          # Server-only Docker build
├── docker-compose.yml                  # Server + Postgres
└── README.md                           # Updated with separated install sections
```

### 2.2 Design Decision: Server Keeps Its Own Copies

**Key decision**: The server keeps its own copies of `logger.ts`, `jsonc.ts`, `secret-resolver.ts`, `privacy.ts`, and `tags.ts` in `src/services/`. Only the plugin references `shared/`.

**Rationale**:

1. **Server has zero import path changes** — the server's existing `from "./config.js"`, `from "./logger.js"`, etc. remain unchanged. This eliminates risk of breaking the server.
2. **`tags.ts` needs different config** — the server's `tags.ts` imports `CONFIG` (full server config). The shared `tags.ts` uses a parameterized `TagsConfig` interface. Keeping separate copies avoids runtime dispatch overhead and type confusion.
3. **No circular dependency risk** — if `src/config.ts` imported from `shared/`, and `shared/client-config.ts` imported from `shared/jsonc.ts`, we'd have cross-directory dependency chains. Keeping server self-contained avoids this.
4. **Dockerfile simplicity** — the server Docker build only needs `src/`, `package.json`, `tsconfig.json`. No need to COPY `shared/` into the builder.

**Files in `shared/` are exclusively used by the plugin** (via `../../shared/` imports). The `shared/` directory name reflects that the code _could_ be used by both, but in practice only the plugin uses it. The server already has working copies in `src/services/`.

### 2.3 What Moves Where

| Action           | File                      | Source                            | Destination                            |
| ---------------- | ------------------------- | --------------------------------- | -------------------------------------- |
| COPY + modify    | `config.ts` lines 630-714 | `src/config.ts`                   | `shared/client-config.ts`              |
| COPY + modify    | `tags.ts`                 | `src/services/tags.ts`            | `shared/tags.ts`                       |
| COPY (no change) | `privacy.ts`              | `src/services/privacy.ts`         | `shared/privacy.ts`                    |
| COPY (no change) | `logger.ts`               | `src/services/logger.ts`          | `shared/logger.ts`                     |
| COPY (no change) | `jsonc.ts`                | `src/services/jsonc.ts`           | `shared/jsonc.ts`                      |
| COPY (no change) | `secret-resolver.ts`      | `src/services/secret-resolver.ts` | `shared/secret-resolver.ts`            |
| COPY (no change) | `types.ts`                | `src/types/index.ts`              | `shared/types.ts`                      |
| MOVE             | `plugin.ts`               | `src/plugin.ts`                   | `plugin/src/plugin.ts` (rewritten)     |
| MOVE             | `index-remote.ts`         | `src/index-remote.ts`             | `plugin/src/index-remote.ts`           |
| MOVE             | `remote-client.ts`        | `src/services/remote-client.ts`   | `plugin/src/services/remote-client.ts` |
| KEEP             | `config.ts`               | `src/config.ts`                   | Stays (client portions removed)        |
| KEEP             | All server files          | `src/**`                          | Stay in place                          |

---

## 3. Plugin Package Design

### 3.1 `plugin/package.json`

```json
{
  "name": "opencode-memnet-plugin",
  "version": "3.0.0",
  "description": "OpenCode plugin client for persistent AI memory via opencode-memnet server",
  "type": "module",
  "main": "dist/opencode-memnet.js",
  "exports": {
    ".": {
      "import": "./dist/opencode-memnet.js"
    }
  },
  "scripts": {
    "build": "bun run build.ts",
    "typecheck": "bunx tsc --noEmit"
  },
  "opencode": {
    "type": "plugin",
    "hooks": ["chat.message", "event"]
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.3.0",
    "@opencode-ai/sdk": "^1.3.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.8",
    "typescript": "^5.7.3"
  },
  "files": ["dist", "package.json"],
  "keywords": ["opencode", "plugin", "memory", "ai", "coding-agent"],
  "license": "MIT"
}
```

**Key points**:

- Only 2 runtime dependencies: `@opencode-ai/plugin` and `@opencode-ai/sdk`.
- No `postgres`, `franc-min`, `iso-639-3`, or `zod`.
- The `opencode` field tells OpenCode this is a plugin with `chat.message` and `event` hooks.
- `files` array only ships `dist/` and `package.json` — no source.

### 3.2 `plugin/tsconfig.json`

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "..",
    "declaration": false,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["src/**/*", "../shared/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Key points**:

- `rootDir` is `..` (parent of `plugin/`) so `../../shared/` relative imports resolve.
- `include` covers both `src/**/*` (plugin source) and `../shared/**/*` (shared utilities).
- Used for type-checking only — `bun build --bundle` produces the actual output.

### 3.3 `plugin/build.ts`

```typescript
import { build } from "bun";

const result = await build({
  entrypoints: ["src/plugin.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  naming: "opencode-memnet.js",
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
  sourcemap: "none",
  minify: false,
});

if (!result.success) {
  console.error("Plugin build failed:", result.logs);
  process.exit(1);
}
console.log(
  "Plugin built:",
  result.outputs.map((o) => o.path)
);
```

**Key points**:

- Run from `plugin/` directory: `cd plugin && bun run build.ts`
- Produces single `plugin/dist/opencode-memnet.js`.
- `external` keeps `@opencode-ai/plugin` and `@opencode-ai/sdk` as runtime imports (not inlined).
- All `shared/` code is inlined by the bundler — no relative import issue at runtime.
- Node.js built-ins (`node:fs`, `node:crypto`, etc.) are automatically externalized by `target: "bun"`.

### 3.4 Entry Point: `plugin/src/plugin.ts`

```typescript
// plugin/src/plugin.ts — Remote-mode ONLY entry point
import type { PluginModule } from "@opencode-ai/plugin";

export const id = "opencode-memnet";

async function resolvePlugin() {
  const { initClientConfig, isClientConfigured } = await import("../../shared/client-config.js");
  initClientConfig(process.cwd());

  if (!isClientConfigured()) {
    console.warn(
      "[opencode-memnet] Not configured. Set serverUrl + apiKey in " +
        "~/.config/opencode/opencode-memnet.jsonc or .opencode/opencode-memnet.jsonc"
    );
    return {};
  }

  const { OpenCodeMemPlugin } = await import("./index-remote.js");
  console.log("[opencode-memnet] Remote server-client mode active");
  return OpenCodeMemPlugin;
}

const OpenCodeMemPlugin = await resolvePlugin();
export { OpenCodeMemPlugin };
export default { id, server: OpenCodeMemPlugin } satisfies PluginModule;
```

**Differences from current `src/plugin.ts`**:

1. No `package.json` import — `id` is hardcoded as `"opencode-memnet"`.
2. No legacy `index.js` fallback — remote mode only.
3. Import paths use `../../shared/` for config and `./index-remote.js` for the plugin implementation.
4. Returns empty `{}` when not configured (graceful no-op).

---

## 4. Config Architecture

### 4.1 Config Split Overview

```
shared/client-config.ts           src/config.ts (simplified)
─────────────────────────         ──────────────────────────
ClientConfig interface            OpenCodeMemConfig interface
CLIENT_DEFAULTS                   DEFAULTS
buildClientConfig()               buildConfig()
CLIENT_CONFIG singleton           CONFIG singleton
initClientConfig()                initConfig()
isClientConfigured()              isConfigured()
                                  validateConfig()
                                  serverConfigToGlobalConfig()
                                  getEmbeddingDimensions()
                                  ensureConfigExists()
                                  CONFIG_TEMPLATE
expandPath() (duplicated)         expandPath() (unchanged)
loadConfigFromPaths() (dup)       loadConfigFromPaths() (unchanged)

Imports:                          Imports:
  shared/jsonc.ts                   src/services/jsonc.ts
  shared/secret-resolver.ts         src/services/secret-resolver.ts
  node:fs, node:path, node:os       node:fs, node:path, node:os
```

### 4.2 `shared/client-config.ts` — Full Design

This file is extracted from `src/config.ts` lines 630-714, plus needed helper functions.

**Exports**:

| Export                        | Type              | Purpose                                      |
| ----------------------------- | ----------------- | -------------------------------------------- |
| `ClientConfig`                | interface         | Client config shape                          |
| `CLIENT_CONFIG`               | mutable singleton | Current client config state                  |
| `initClientConfig(directory)` | function          | Loads and merges global + project config     |
| `isClientConfigured()`        | function          | Returns `true` if `serverUrl` + `apiKey` set |
| `buildClientConfig(partial)`  | function          | Merges partial config with defaults          |

**Code** (exact extraction from `src/config.ts`):

```typescript
// shared/client-config.ts
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./jsonc.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_FILES = [
  join(CONFIG_DIR, "opencode-memnet.jsonc"),
  join(CONFIG_DIR, "opencode-memnet.json"),
];

if (!existsSync(CONFIG_DIR)) {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

// ── Client Config ─────────────────────────────────────────────

export interface ClientConfig {
  serverUrl: string;
  apiKey: string;
  autoCaptureEnabled: boolean;
  showAutoCaptureToasts: boolean;
  showErrorToasts: boolean;
  chatMessage: {
    enabled: boolean;
    maxMemories: number;
    excludeCurrentSession: boolean;
    maxAgeDays?: number;
    injectOn: "first" | "always";
  };
  memory: {
    defaultScope: "project" | "all-projects";
  };
}

const CLIENT_DEFAULTS: ClientConfig = {
  serverUrl: "http://localhost:4747",
  apiKey: "",
  autoCaptureEnabled: true,
  showAutoCaptureToasts: true,
  showErrorToasts: true,
  chatMessage: {
    enabled: true,
    maxMemories: 3,
    excludeCurrentSession: true,
    maxAgeDays: undefined,
    injectOn: "first",
  },
  memory: {
    defaultScope: "project",
  },
};

function buildClientConfig(fileConfig: Partial<ClientConfig>): ClientConfig {
  return {
    serverUrl: fileConfig.serverUrl ?? CLIENT_DEFAULTS.serverUrl,
    apiKey: fileConfig.apiKey ?? CLIENT_DEFAULTS.apiKey,
    autoCaptureEnabled: fileConfig.autoCaptureEnabled ?? CLIENT_DEFAULTS.autoCaptureEnabled,
    showAutoCaptureToasts:
      fileConfig.showAutoCaptureToasts ?? CLIENT_DEFAULTS.showAutoCaptureToasts,
    showErrorToasts: fileConfig.showErrorToasts ?? CLIENT_DEFAULTS.showErrorToasts,
    chatMessage: {
      enabled: fileConfig.chatMessage?.enabled ?? CLIENT_DEFAULTS.chatMessage.enabled,
      maxMemories: fileConfig.chatMessage?.maxMemories ?? CLIENT_DEFAULTS.chatMessage.maxMemories,
      excludeCurrentSession:
        fileConfig.chatMessage?.excludeCurrentSession ??
        CLIENT_DEFAULTS.chatMessage.excludeCurrentSession,
      maxAgeDays: fileConfig.chatMessage?.maxAgeDays,
      injectOn: (fileConfig.chatMessage?.injectOn ?? CLIENT_DEFAULTS.chatMessage.injectOn) as
        | "first"
        | "always",
    },
    memory: {
      defaultScope: fileConfig.memory?.defaultScope ?? CLIENT_DEFAULTS.memory.defaultScope,
    },
  };
}

// Helper: load first existing JSON/JSONC config file from a list of paths
function loadConfigFromPaths(paths: string[]): Partial<ClientConfig> {
  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const json = stripJsoncComments(content);
        return JSON.parse(json) as Partial<ClientConfig>;
      } catch (err) {
        console.warn("[client-config] Failed to parse:", path, String(err));
      }
    }
  }
  return {};
}

export let CLIENT_CONFIG = buildClientConfig({});

export function initClientConfig(directory: string): void {
  const projectPaths = [
    join(directory, ".opencode", "opencode-memnet.jsonc"),
    join(directory, ".opencode", "opencode-memnet.json"),
  ];
  const globalConfig = loadConfigFromPaths(CONFIG_FILES);
  const projectConfig = loadConfigFromPaths(projectPaths);
  const merged: Partial<ClientConfig> = { ...globalConfig, ...projectConfig };
  if (globalConfig.chatMessage && projectConfig.chatMessage) {
    merged.chatMessage = { ...globalConfig.chatMessage, ...projectConfig.chatMessage };
  }
  if (globalConfig.memory && projectConfig.memory) {
    merged.memory = { ...globalConfig.memory, ...projectConfig.memory };
  }
  CLIENT_CONFIG = buildClientConfig(merged);
}

export function isClientConfigured(): boolean {
  return !!CLIENT_CONFIG.serverUrl && !!CLIENT_CONFIG.apiKey;
}
```

### 4.3 `src/config.ts` — Simplified

The server's `config.ts` remains at its current location with the following changes:

**Removals** (lines 630-714):

- `ClientConfig` interface
- `CLIENT_DEFAULTS`
- `buildClientConfig()`
- `CLIENT_CONFIG` singleton
- `initClientConfig()`
- `isClientConfigured()`

**Kept** (everything else):

- `OpenCodeMemConfig` interface
- `DEFAULTS`
- `buildConfig()`
- `CONFIG` singleton
- `initConfig()`
- `isConfigured()`
- `getConfigErrors()`
- `serverConfigToGlobalConfig()`
- `validateConfig()`
- `getEmbeddingDimensions()`
- `ensureConfigExists()`
- `CONFIG_TEMPLATE`
- `loadConfigFromPaths()`
- `expandPath()`

The removed code is approximately 85 lines (lines 630-714). The server `config.ts` goes from 872 lines to ~787 lines.

### 4.4 Config Defaults Merge Flow

```
Client Config Flow:
  ~/.config/opencode/opencode-memnet.jsonc  ─┐
  ~/.config/opencode/opencode-memnet.json   ─┤─ merge ──► buildClientConfig() ──► CLIENT_CONFIG
  .opencode/opencode-memnet.jsonc           ─┤              ↑
  .opencode/opencode-memnet.json            ─┘        CLIENT_DEFAULTS applied

Server Config Flow:
  Environment variables ──► initServerConfig() ──► ServerConfig
                                                      │
                                                      ▼
                                           serverConfigToGlobalConfig()
                                                      │
                                                      ▼
                                              CONFIG (global singleton)
```

---

## 5. Shared Module Design

### 5.1 `shared/` File Inventory

| File                        | Source                                 | Lines | Changes from Source                                  |
| --------------------------- | -------------------------------------- | ----- | ---------------------------------------------------- |
| `shared/client-config.ts`   | Extracted from `src/config.ts:630-714` | ~95   | Self-contained; imports `./jsonc.js`                 |
| `shared/tags.ts`            | `src/services/tags.ts`                 | ~200  | Replaced `CONFIG` import with `TagsConfig` parameter |
| `shared/privacy.ts`         | `src/services/privacy.ts`              | 8     | None — pure functions                                |
| `shared/logger.ts`          | `src/services/logger.ts`               | 64    | None — self-contained                                |
| `shared/jsonc.ts`           | `src/services/jsonc.ts`                | 129   | None — pure functions                                |
| `shared/secret-resolver.ts` | `src/services/secret-resolver.ts`      | 68    | None — self-contained                                |
| `shared/types.ts`           | `src/types/index.ts`                   | 20    | None — type exports only                             |

### 5.2 `shared/tags.ts` — Parameterized Design

The current `src/services/tags.ts` imports `CONFIG` from `../config.js` and uses three fields:

- `CONFIG.containerTagPrefix`
- `CONFIG.userEmailOverride`
- `CONFIG.userNameOverride`

The shared version replaces the direct `CONFIG` dependency with a parameterized `TagsConfig`:

```typescript
// shared/tags.ts
import { createHash } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { normalize, resolve, isAbsolute, basename, dirname } from "node:path";
import { realpathSync, existsSync } from "node:fs";

const execAsync = promisify(exec);

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export interface TagInfo {
  tag: string;
  displayName: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

// NEW: Config interface for tag resolution — decoupled from CONFIG/CLIENT_CONFIG
export interface TagsConfig {
  containerTagPrefix: string;
  userEmailOverride?: string;
  userNameOverride?: string;
}

// ... (getGitEmail, getGitName, getGitRepoUrl, getGitCommonDir,
//      getGitTopLevel, getProjectRoot, getProjectIdentity, getProjectName
//      all remain identical) ...

export async function getUserTagInfo(config: TagsConfig): Promise<TagInfo> {
  const email = config.userEmailOverride || (await getGitEmail());
  const name = config.userNameOverride || (await getGitName());

  if (email) {
    return {
      tag: `${config.containerTagPrefix}_user_${sha256(email)}`,
      displayName: name || email,
      userName: name || undefined,
      userEmail: email,
    };
  }

  const fallback = name || process.env.USER || process.env.USERNAME || "anonymous";
  return {
    tag: `${config.containerTagPrefix}_user_${sha256(fallback)}`,
    displayName: fallback,
    userName: fallback,
    userEmail: undefined,
  };
}

export async function getProjectTagInfo(directory: string, config: TagsConfig): Promise<TagInfo> {
  const projectRoot = await getProjectRoot(directory);
  const projectName = getProjectName(projectRoot);
  const [gitRepoUrl, projectIdentity] = await Promise.all([
    getGitRepoUrl(directory),
    getProjectIdentity(projectRoot),
  ]);

  return {
    tag: `${config.containerTagPrefix}_project_${sha256(projectIdentity)}`,
    displayName: projectRoot,
    projectPath: projectRoot,
    projectName,
    gitRepoUrl: gitRepoUrl || undefined,
  };
}

interface TagsResult {
  user: TagInfo;
  project: TagInfo;
}

let cachedTagsByDir = new Map<string, { tags: TagsResult; timestamp: number }>();
const CACHE_TTL = 60_000;

// NEW: getTags now requires a TagsConfig parameter
export async function getTags(directory: string, config: TagsConfig): Promise<TagsResult> {
  const cached = cachedTagsByDir.get(directory);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.tags;
  }

  const [user, project] = await Promise.all([
    getUserTagInfo(config),
    getProjectTagInfo(directory, config),
  ]);

  const result = { user, project };
  cachedTagsByDir.set(directory, { tags: result, timestamp: Date.now() });
  return result;
}
```

### 5.3 How Plugin Passes TagsConfig

In `plugin/src/index-remote.ts`, the `getTags()` call changes:

```typescript
// BEFORE:
import { getTags } from "./services/tags.js";
const tags = await getTags(directory);

// AFTER:
import { getTags } from "../../shared/tags.js";
import { CLIENT_CONFIG } from "../../shared/client-config.js";
// CLIENT_CONFIG doesn't have containerTagPrefix — use a constant:
const TAGS_CONFIG = {
  containerTagPrefix: "opencode",
  userEmailOverride: undefined,
  userNameOverride: undefined,
};
const tags = await getTags(directory, TAGS_CONFIG);
```

**Note**: The client config (`ClientConfig`) does NOT include `containerTagPrefix`, `userEmailOverride`, or `userNameOverride`. These fields exist only in the server's `CONFIG`. For the plugin, we hardcode `containerTagPrefix: "opencode"` (matching `DEFAULTS.containerTagPrefix`) and leave user overrides as `undefined` (meaning git config will be used).

### 5.4 How Server's `src/services/tags.ts` Stays Unchanged

The server's existing `src/services/tags.ts` continues to import `CONFIG` from `../config.js` directly. No changes needed — it already works correctly.

---

## 6. Build System Design

### 6.1 Plugin Build

**Command** (run from `plugin/` directory):

```bash
cd plugin && bun run build
```

This executes `bun run build.ts` which runs:

```
bun build src/plugin.ts --outdir dist --target bun --format esm --naming opencode-memnet.js --external @opencode-ai/plugin --external @opencode-ai/sdk
```

**Output**: `plugin/dist/opencode-memnet.js` — a single bundled ESM file.

**What gets inlined**:

- `plugin/src/plugin.ts`
- `plugin/src/index-remote.ts`
- `plugin/src/services/remote-client.ts`
- `shared/client-config.ts`
- `shared/tags.ts`
- `shared/privacy.ts`
- `shared/logger.ts`
- `shared/jsonc.ts`
- `shared/secret-resolver.ts`
- `shared/types.ts`

**What stays external**:

- `@opencode-ai/plugin` — runtime dependency
- `@opencode-ai/sdk` — runtime dependency (type-only but still declared)
- `node:fs`, `node:crypto`, `node:child_process`, `node:util`, `node:path`, `node:os` — Node.js built-ins

### 6.2 Server Build

**Command** (run from root):

```bash
bun run build
```

This executes:

```bash
bunx tsc && mkdir -p dist/web && cp -r src/web/* dist/web/
```

**Unchanged from current build**. The server's `tsconfig.json` excludes `plugin/` to prevent tsc from compiling plugin source.

### 6.3 Root `package.json` Changes

```json
{
  "name": "opencode-memnet-server",
  "version": "3.0.0",
  "description": "Standalone memory server for OpenCode persistent AI memory",
  "type": "module",
  "exports": {
    "./server": {
      "import": "./dist/server.js"
    }
  },
  "scripts": {
    "build": "bunx tsc && mkdir -p dist/web && cp -r src/web/* dist/web/",
    "build:plugin": "cd plugin && bun run build",
    "build:all": "bun run build && bun run build:plugin",
    "start:server": "bun run dist/server.js",
    "dev:server": "bun run --watch src/server.ts",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "typecheck:plugin": "cd plugin && bun run typecheck",
    "typecheck:all": "bun run typecheck && bun run typecheck:plugin",
    "format": "prettier --write \"src/**/*.{ts,js,css,html}\"",
    "format:check": "prettier --check \"src/**/*.{ts,js,css,html}\"",
    "prepare": "husky"
  },
  "keywords": ["opencode", "memory", "server", "vector-database", "ai", "postgres", "pgvector"],
  "author": "opencode-memnet",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/tickernelz/opencode-mem.git"
  },
  "publishConfig": {
    "access": "public"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.3.0",
    "@opencode-ai/sdk": "^1.3.0",
    "franc-min": "^6.2.0",
    "iso-639-3": "^3.0.1",
    "postgres": "^3.4.9",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/bun": "^1.3.8",
    "husky": "^9.1.7",
    "lint-staged": "^16.2.7",
    "prettier": "^3.4.2",
    "typescript": "^5.7.3"
  },
  "files": ["dist", "package.json"],
  "lint-staged": {
    "*.{ts,tsx,js,jsx,css,html,json,md}": ["prettier --write"]
  }
}
```

**Changes from current**:

1. `name`: `"opencode-memnet"` → `"opencode-memnet-server"`
2. `description`: Updated to reflect server-only role
3. Removed `"main"` field (server is not a library entry point)
4. Removed `"types"` field
5. Removed `"."` export — plugin is now separate package
6. Added `build:plugin`, `build:all`, `typecheck:plugin`, `typecheck:all` scripts
7. Keywords updated to reflect server role

### 6.4 Root `tsconfig.json` Changes

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "allowJs": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "plugin"]
}
```

**Change**: Added `"plugin"` to `exclude` array to prevent tsc from compiling plugin source.

---

## 7. Deprecation Design

### 7.1 What Gets Deprecated

| Item                       | Current Location                          | Action                                                                         |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| In-process mode            | `src/index.ts`                            | Add `@deprecated` JSDoc. Keep file for reference. Do NOT delete.               |
| `src/plugin.ts` (original) | `src/plugin.ts`                           | Add `@deprecated` JSDoc. Keep for reference. Not used by new build.            |
| `CONFIG` usage in plugin   | `src/config.ts` via `src/index-remote.ts` | Plugin no longer imports from `src/config.ts`. Uses `shared/client-config.ts`. |

### 7.2 `src/plugin.ts` — Deprecated Annotation

```typescript
// src/plugin.ts — @deprecated — This file is kept for reference only.
// The active plugin entry point is now at plugin/src/plugin.ts
// This file will not be included in any build output.
```

### 7.3 `src/index.ts` — Deprecated Annotation

```typescript
// src/index.ts — @deprecated — Legacy in-process mode.
// This module is kept for reference only. In-process mode is removed in v3.0.0.
// All users should migrate to server-client mode (plugin/ + server).
```

### 7.4 Migration Path for Users

**Breaking change** — major version bump to 3.0.0.

Users currently running in-process mode (no `serverUrl`/`apiKey` configured):

1. Plugin loads → no `serverUrl`/`apiKey` found → warning message:
   ```
   [opencode-memnet] Not configured. Set serverUrl + apiKey in
   ~/.config/opencode/opencode-memnet.jsonc or .opencode/opencode-memnet.jsonc
   ```
2. Plugin returns empty hooks (no-op behavior — no crashes, no errors).
3. User must set up a server and configure `serverUrl`/`apiKey` in config.

---

## 8. Quickstart Script Design

### 8.1 Client Install Script: `scripts/install-client.sh`

**Design principles**:

- Non-interactive — NO `read -p` prompts
- All config via environment variables
- Idempotent — safe to run multiple times
- Creates/updates config files

**Step-by-step logic**:

1. Parse environment variables: `OPENCODE_MEM_SERVER_URL`, `OPENCODE_MEM_API_KEY`
2. Default `SERVER_URL` to `http://localhost:4747`
3. Create `~/.config/opencode/` directory
4. If config file exists: create/update `opencode-memnet.json` (takes precedence over `.jsonc`)
5. If config file doesn't exist: create `opencode-memnet.jsonc` with defaults
6. Print confirmation with config file path

```bash
#!/usr/bin/env bash
# scripts/install-client.sh
# Install opencode-memnet plugin for OpenCode
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-client.sh \
#     | OPENCODE_MEM_SERVER_URL=http://myserver:4747 OPENCODE_MEM_API_KEY=my-key bash
#
# Environment variables:
#   OPENCODE_MEM_SERVER_URL  — Server URL (default: http://localhost:4747)
#   OPENCODE_MEM_API_KEY     — API key for server authentication (required)

set -euo pipefail

SERVER_URL="${OPENCODE_MEM_SERVER_URL:-http://localhost:4747}"
API_KEY="${OPENCODE_MEM_API_KEY:-}"
CONFIG_DIR="${HOME}/.config/opencode"
CONFIG_FILE="${CONFIG_DIR}/opencode-memnet.jsonc"
JSON_FILE="${CONFIG_DIR}/opencode-memnet.json"

# Ensure config directory exists
mkdir -p "${CONFIG_DIR}"

if [ -z "${API_KEY}" ]; then
  echo "[opencode-memnet] WARNING: OPENCODE_MEM_API_KEY is not set."
  echo "[opencode-memnet] The plugin will not activate without an API key."
fi

# Write JSON config (takes precedence over .jsonc for override values)
cat > "${JSON_FILE}" << EOF
{
  "serverUrl": "${SERVER_URL}",
  "apiKey": "${API_KEY}",
  "autoCaptureEnabled": true,
  "showAutoCaptureToasts": true
}
EOF

echo "[opencode-memnet] Client config written to ${JSON_FILE}"
echo "[opencode-memnet] Server URL: ${SERVER_URL}"
echo ""
echo "[opencode-memnet] Install complete. The plugin will activate on next OpenCode session."
```

### 8.2 Server Install Script: `scripts/install-server.sh`

**Design principles**:

- Non-interactive — all config via env vars
- Validates required env vars before proceeding
- Clones repo and starts Docker Compose
- Idempotent — safe to re-run (git pull if exists)

```bash
#!/usr/bin/env bash
# scripts/install-server.sh
# Install opencode-memnet server via Docker Compose
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-server.sh \
#     | EMBEDDING_API_URL=https://api.openai.com/v1 \
#       EMBEDDING_MODEL=text-embedding-3-small \
#       EMBEDDING_API_KEY=sk-... \
#       SERVER_API_KEY=my-secret \
#       bash
#
# Required environment variables:
#   EMBEDDING_API_URL   — Embedding API endpoint
#   EMBEDDING_MODEL     — Embedding model name
#   EMBEDDING_API_KEY   — API key for embedding service
#   SERVER_API_KEY      — Secret key for server authentication
#
# Optional environment variables:
#   MEMORY_MODEL        — Chat model for auto-capture
#   MEMORY_API_URL      — Chat API URL
#   MEMORY_API_KEY      — Chat API key
#   SERVER_PORT         — Port (default: 4747)
#   OPENCODE_MEM_INSTALL_DIR — Install directory (default: ~/.opencode-memnet-server)

set -euo pipefail

: "${EMBEDDING_API_URL:?ERROR: EMBEDDING_API_URL is required}"
: "${EMBEDDING_MODEL:?ERROR: EMBEDDING_MODEL is required}"
: "${EMBEDDING_API_KEY:?ERROR: EMBEDDING_API_KEY is required}"
: "${SERVER_API_KEY:?ERROR: SERVER_API_KEY is required}"

INSTALL_DIR="${OPENCODE_MEM_INSTALL_DIR:-${HOME}/.opencode-memnet-server}"
SERVER_PORT="${SERVER_PORT:-4747}"

echo "[opencode-memnet] Installing server to ${INSTALL_DIR}..."

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "[opencode-memnet] ERROR: Docker is not installed. Please install Docker first."
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "[opencode-memnet] ERROR: Docker Compose is not available. Please install it."
  exit 1
fi

# Clone/update repo
if [ -d "${INSTALL_DIR}/.git" ]; then
  echo "[opencode-memnet] Repository exists, pulling latest..."
  git -C "${INSTALL_DIR}" pull --ff-only
else
  echo "[opencode-memnet] Cloning repository..."
  git clone --depth 1 https://github.com/tickernelz/opencode-mem.git "${INSTALL_DIR}"
fi

# Create .env file
cat > "${INSTALL_DIR}/.env" << EOF
EMBEDDING_API_URL=${EMBEDDING_API_URL}
EMBEDDING_MODEL=${EMBEDDING_MODEL}
EMBEDDING_API_KEY=${EMBEDDING_API_KEY}
SERVER_API_KEY=${SERVER_API_KEY}
SERVER_PORT=${SERVER_PORT}
MEMORY_MODEL=${MEMORY_MODEL:-}
MEMORY_API_URL=${MEMORY_API_URL:-}
MEMORY_API_KEY=${MEMORY_API_KEY:-}
EOF

# Start services
echo "[opencode-memnet] Starting Docker services..."
docker compose -f "${INSTALL_DIR}/docker-compose.yml" up -d --build

echo ""
echo "[opencode-memnet] Server starting on http://localhost:${SERVER_PORT}"
echo "[opencode-memnet] WebUI:    http://localhost:${SERVER_PORT}/"
echo "[opencode-memnet] Health:   http://localhost:${SERVER_PORT}/api/health"
echo ""
echo "[opencode-memnet] Logs:  docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
echo "[opencode-memnet] Stop:  docker compose -f ${INSTALL_DIR}/docker-compose.yml down"
```

---

## 9. Dockerfile Changes

### 9.1 Updated Dockerfile

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN bunx tsc
RUN mkdir -p dist/web && cp -r src/web/* dist/web/

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./

EXPOSE 4747

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:4747/api/health').then(r=>r.json()).then(d=>{if(d.status!=='ok')process.exit(1)})"

ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=4747

CMD ["bun", "run", "dist/server.js"]
```

**Changes from current**: None required. The Dockerfile already only copies `src/` — it doesn't need `shared/` or `plugin/`. The server keeps its own copies of all utilities in `src/services/`.

**Why no `shared/` COPY**: The server doesn't import from `shared/`. It uses its own `src/services/logger.ts`, `src/services/jsonc.ts`, etc. that remain in place.

### 9.2 Docker Build Context

The `.dockerignore` file (if it exists, or should be created) should exclude:

```
plugin/
shared/
scripts/
tests/
*.md
.git/
node_modules/
```

This ensures only server-relevant files are in the Docker build context.

---

## 10. Import Path Migration Map

### 10.1 Plugin Files — Import Changes

| File                                   | Old Import                                                                 | New Import                                       |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| `plugin/src/plugin.ts` (new)           | N/A                                                                        | `../../shared/client-config.js`                  |
| `plugin/src/plugin.ts` (new)           | N/A                                                                        | `./index-remote.js`                              |
| `plugin/src/index-remote.ts`           | `from "./services/remote-client.js"`                                       | `from "./services/remote-client.js"` (unchanged) |
| `plugin/src/index-remote.ts`           | `from "./services/tags.js"`                                                | `from "../../shared/tags.js"`                    |
| `plugin/src/index-remote.ts`           | `from "./services/privacy.js"`                                             | `from "../../shared/privacy.js"`                 |
| `plugin/src/index-remote.ts`           | `from "./config.js"` (CLIENT_CONFIG, initClientConfig, isClientConfigured) | `from "../../shared/client-config.js"`           |
| `plugin/src/index-remote.ts`           | `from "./services/logger.js"`                                              | `from "../../shared/logger.js"`                  |
| `plugin/src/services/remote-client.ts` | `from "../config.js"` (CLIENT_CONFIG)                                      | `from "../../shared/client-config.js"`           |
| `plugin/src/services/remote-client.ts` | `from "./logger.js"`                                                       | `from "../../shared/logger.js"`                  |

### 10.2 Server Files — No Import Changes

All server files in `src/` keep their current import paths. No migration needed:

| File                           | Import                                 | Status    |
| ------------------------------ | -------------------------------------- | --------- |
| `src/server.ts`                | `from "./server-config.js"`            | Unchanged |
| `src/server.ts`                | `from "./config.js"`                   | Unchanged |
| `src/services/tags.ts`         | `from "../config.js"`                  | Unchanged |
| `src/services/api-handlers.ts` | `from "../config.js"`                  | Unchanged |
| `src/services/web-server.ts`   | `from "./logger.js"`                   | Unchanged |
| `src/config.ts`                | `from "./services/jsonc.js"`           | Unchanged |
| `src/config.ts`                | `from "./services/secret-resolver.js"` | Unchanged |
| `src/server-config.ts`         | `from "./services/secret-resolver.js"` | Unchanged |
| All other server files         | All imports                            | Unchanged |

### 10.3 Shared Files — Internal Imports

| File                        | Import              | Note                                                    |
| --------------------------- | ------------------- | ------------------------------------------------------- |
| `shared/client-config.ts`   | `from "./jsonc.js"` | Uses local shared import                                |
| `shared/tags.ts`            | No config imports   | Parameterized via `TagsConfig`                          |
| `shared/logger.ts`          | No project imports  | Self-contained (uses `fs`, `os`, `path`)                |
| `shared/jsonc.ts`           | No imports          | Pure function                                           |
| `shared/secret-resolver.ts` | No project imports  | Self-contained (uses `node:fs`, `node:path`, `node:os`) |
| `shared/privacy.ts`         | No imports          | Pure functions                                          |
| `shared/types.ts`           | No imports          | Type exports only                                       |

### 10.4 `plugin/src/index-remote.ts` — Call Site Changes

```typescript
// BEFORE (current):
const tags = await getTags(directory);

// AFTER (new — getTags requires TagsConfig parameter):
import { getTags, type TagsConfig } from "../../shared/tags.js";

const TAGS_CONFIG: TagsConfig = {
  containerTagPrefix: "opencode", // matches DEFAULTS.containerTagPrefix
  userEmailOverride: undefined,
  userNameOverride: undefined,
};

// Inside the plugin function:
const tags = await getTags(directory, TAGS_CONFIG);
```

---

## 11. Testing Strategy

### 11.1 Plugin Independent Compilation Test

```bash
# 1. Verify plugin compiles independently
cd plugin
bun install
bun run build
# Expected: plugin/dist/opencode-memnet.js created, exit code 0

# 2. Verify output is a single file
ls -la plugin/dist/opencode-memnet.js
# Expected: single file exists

# 3. Verify no server dependencies in output
grep -c "postgres" plugin/dist/opencode-memnet.js  # Expected: 0
grep -c "franc-min" plugin/dist/opencode-memnet.js  # Expected: 0
grep -c "iso-639-3" plugin/dist/opencode-memnet.js  # Expected: 0
grep -c "zod" plugin/dist/opencode-memnet.js         # Expected: 0

# 4. Verify no references to server-only code
grep -c "storage/postgres" plugin/dist/opencode-memnet.js    # Expected: 0
grep -c "services/embedding" plugin/dist/opencode-memnet.js  # Expected: 0
grep -c "services/ai/" plugin/dist/opencode-memnet.js        # Expected: 0
grep -c "src/index.js" plugin/dist/opencode-memnet.js        # Expected: 0 (no legacy)

# 5. Verify type-check passes
cd plugin && bunx tsc --noEmit
# Expected: exit code 0, no errors
```

### 11.2 Server Independent Compilation Test

```bash
# 1. Verify server compiles
bun run build
# Expected: dist/ directory populated, exit code 0

# 2. Verify no plugin references
grep -c "plugin/src" dist/server.js  # Expected: 0
grep -c "plugin/" dist/server.js     # Expected: 0

# 3. Verify type-check passes
bunx tsc --noEmit
# Expected: exit code 0, no errors
```

### 11.3 Combined Build Test

```bash
# 1. Build both
bun run build:all
# Expected: both dist/ and plugin/dist/ populated

# 2. Type-check both
bun run typecheck:all
# Expected: exit code 0, no errors in either
```

### 11.4 Integration Test Approach

Manual integration test checklist:

1. **Server starts**: `docker compose up -d` → health check returns `{"status":"ok"}`
2. **Plugin loads in OpenCode**: Configure `serverUrl` + `apiKey` → plugin activates
3. **Memory operations**: Use `memory add`, `memory search`, `memory list`, `memory forget` → all succeed via HTTP
4. **Auto-capture**: Send chat messages → `session.idle` event triggers auto-capture → memory appears in WebUI
5. **Context injection**: New chat message → relevant memories injected as context
6. **Session compaction**: `session.compacted` event → memories restored
7. **Graceful no-op**: Remove `serverUrl`/`apiKey` → plugin logs warning, returns empty hooks, no errors

---

## 12. Verification Checklist

- [ ] `shared/` directory created with all 7 files
- [ ] `plugin/` directory created with `package.json`, `tsconfig.json`, `build.ts`, `src/`
- [ ] `plugin/src/plugin.ts` — remote mode only, no legacy fallback
- [ ] `plugin/src/index-remote.ts` — all imports updated to `../../shared/`
- [ ] `plugin/src/services/remote-client.ts` — imports updated to `../../shared/`
- [ ] `shared/tags.ts` — parameterized with `TagsConfig`, no `CONFIG` import
- [ ] `shared/client-config.ts` — self-contained, imports only `./jsonc.js`
- [ ] `src/config.ts` — `ClientConfig`/`CLIENT_CONFIG`/`initClientConfig`/`isClientConfigured` removed
- [ ] Root `tsconfig.json` — `plugin` in `exclude` array
- [ ] Root `package.json` — `build:plugin`, `build:all` scripts added; `"."` export removed
- [ ] `plugin/package.json` — only `@opencode-ai` deps
- [ ] `cd plugin && bun install && bun run build` succeeds
- [ ] `bun run build` succeeds (server)
- [ ] `bun run build:all` succeeds (both)
- [ ] `bun run typecheck:all` passes
- [ ] No import in `plugin/` references `src/`
- [ ] No import in `src/` references `plugin/`
- [ ] `shared/` files have no dependency on `plugin/` or `src/`
- [ ] `scripts/install-client.sh` — non-interactive, env var driven
- [ ] `scripts/install-server.sh` — non-interactive, env var driven
- [ ] `Dockerfile` unchanged (server-only build)
- [ ] `src/plugin.ts` and `src/index.ts` have `@deprecated` annotations
- [ ] README.md updated with separated architecture
