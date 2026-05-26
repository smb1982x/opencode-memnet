# SPEC: Plugin-Server Separation

## Document Metadata

- **ID**: SPEC-PLUGIN-SEPARATION
- **Status**: Draft
- **Created**: 2026-05-26
- **Target Version**: 3.0.0

---

## 1. Overview

### 1.1 Problem

The `opencode-memnet` package currently bundles the client plugin, in-process legacy mode, server code, storage layer, embedding service, and AI providers into a single `src/` directory compiled as one unit. This means:

1. **Plugin consumers pull server dependencies** — anyone installing the OpenCode plugin gets `postgres`, `franc-min`, `iso-639-3`, and all server-side code in their `node_modules`.
2. **No independent compilation** — the plugin cannot be built without the server's TypeScript source existing alongside it.
3. **Legacy code is still active** — `plugin.ts` still falls back to in-process mode (`index.ts`), which pulls in the entire storage/embedding/AI stack.
4. **Single output file** — `dist/plugin.js` is a simple tsc output that depends on relative imports to every other `dist/` file.

### 1.2 Goal

Separate the **client plugin** from the **server** so that:

1. The plugin lives in `plugin/` and compiles independently into a **single bundled JS file** with no server code.
2. The server stays in `src/` with its own build process.
3. In-process (legacy) mode is removed from the plugin — only remote mode exists.
4. Quickstart install scripts allow one-line client and server installation via `curl | bash`.

### 1.3 Scope

- Directory restructuring (plugin → `plugin/`)
- Build system changes (bun build --bundle for plugin, tsc for server)
- Config splitting (client-only config extracted)
- Shared code strategy (shared utilities)
- Deprecation of in-process mode
- README.md rewrite with quickstart scripts
- Git commits after each phase

---

## 2. Current State Analysis

### 2.1 Directory Structure (Current)

```
opencode-memnet/
├── src/
│   ├── plugin.ts                    # ESM entry — detects mode, loads index or index-remote
│   ├── index.ts                     # LEGACY in-process plugin (570 lines)
│   ├── index-remote.ts              # Remote plugin implementation (284 lines)
│   ├── server.ts                    # Standalone headless server (95 lines)
│   ├── server-config.ts             # Server env-var config (153 lines)
│   ├── config.ts                    # Full config loader (872 lines)
│   ├── types/
│   │   └── index.ts                 # Type exports (20 lines)
│   ├── web/                         # Management WebUI static files
│   │   ├── index.html
│   │   ├── app.js
│   │   ├── styles.css
│   │   ├── i18n.js
│   │   ├── opencode-memnet-diagram.svg
│   │   └── favicon.ico
│   └── services/
│       ├── remote-client.ts         # HTTP client for server API (239 lines)
│       ├── client.ts                # LocalMemoryClient facade
│       ├── context.ts               # Memory context formatting
│       ├── tags.ts                  # Git identity / tag resolution (196 lines)
│       ├── privacy.ts               # Private content stripping (8 lines)
│       ├── logger.ts                # File-based logging (64 lines)
│       ├── jsonc.ts                 # JSONC parser (129 lines)
│       ├── secret-resolver.ts       # Secret value resolution (68 lines)
│       ├── embedding.ts             # Remote embedding service
│       ├── auth.ts                  # Bearer token middleware
│       ├── health-handler.ts        # Health check endpoint
│       ├── web-server.ts            # HTTP server + API routes
│       ├── web-server-worker.ts     # Web server worker
│       ├── api-handlers.ts          # API route handlers
│       ├── auto-capture.ts          # Plugin-side auto-capture
│       ├── auto-capture-server.ts   # Server-side auto-capture
│       ├── user-memory-learning.ts  # Plugin-side profile learning
│       ├── user-profile-learner-server.ts  # Server-side profile learning
│       ├── language-detector.ts     # Language detection
│       ├── tag-migration-service.ts # Background tag migration
│       ├── user-profile/            # Profile types and utils
│       ├── ai/                      # AI provider abstraction
│       │   ├── ai-provider-factory.ts
│       │   ├── opencode-provider.ts
│       │   ├── provider-config.ts
│       │   ├── tools/tool-schema.ts
│       │   ├── validators/user-profile-validator.ts
│       │   └── providers/
│       │       ├── base-provider.ts
│       │       └── openai-chat-completion.ts
│       └── storage/                 # Storage abstraction + Postgres
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
├── tests/
├── dist/                            # tsc output (everything)
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

### 2.2 Dependency Graph — Remote Plugin Only

The remote client plugin (`index-remote.ts`) has this import tree:

```
plugin.ts
├── package.json (name for plugin ID)
├── config.js
│   ├── initClientConfig()
│   ├── isClientConfigured()
│   ├── CLIENT_CONFIG (exported mutable singleton)
│   └── imports: services/jsonc.js, services/secret-resolver.js, node:fs, node:path, node:os
├── index-remote.js
│   ├── @opencode-ai/plugin (tool, Plugin, PluginInput types)
│   ├── @opencode-ai/sdk (Part type — type-only)
│   ├── services/remote-client.js → imports config.js (CLIENT_CONFIG), services/logger.js
│   ├── services/tags.js → imports config.js (CONFIG), node:crypto, node:child_process, node:util, node:path, node:fs
│   ├── services/privacy.js (pure functions, no imports)
│   ├── services/logger.js → node:fs, node:os, node:path
│   └── config.js (CLIENT_CONFIG, initClientConfig, isClientConfigured)
```

**Critical observation**: `tags.ts` imports `CONFIG` (the full server config singleton), but only uses `CONFIG.containerTagPrefix`, `CONFIG.userEmailOverride`, and `CONFIG.userNameOverride`. The client plugin does NOT need the full CONFIG — it only needs `CLIENT_CONFIG` plus a few tag-related fields.

### 2.3 NPM Dependencies (Current)

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.3.0", // Plugin SDK — needed by BOTH
    "@opencode-ai/sdk": "^1.3.0", // SDK types — needed by BOTH (type-only)
    "franc-min": "^6.2.0", // Language detection — SERVER only
    "iso-639-3": "^3.0.1", // Language codes — SERVER only
    "postgres": "^3.4.9", // PostgreSQL driver — SERVER only
    "zod": "^4.3.6" // Validation — SERVER only
  }
}
```

### 2.4 Build Process (Current)

```bash
bunx tsc                          # Compiles ALL src/ → dist/
mkdir -p dist/web && cp -r src/web/* dist/web/  # Copy static WebUI
```

- Output: `dist/plugin.js` (ESM entry, tsc-compiled, NOT bundled)
- `dist/plugin.js` does `await import("./index-remote.js")` or `await import("./index.js")` at runtime
- All relative imports resolved at runtime from `dist/` directory
- `package.json` `"files": ["dist", "package.json"]` ships everything

### 2.5 Export Configuration (Current)

```json
{
  "exports": {
    ".": {
      "import": "./dist/plugin.js",
      "types": "./dist/index.d.ts"
    },
    "./server": {
      "import": "./dist/server.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

---

## 3. Target Architecture

### 3.1 Directory Structure (Target)

```
opencode-memnet/
├── shared/                          # Shared utilities used by BOTH plugin and server
│   ├── client-config.ts             # Client-only config (~100 lines, extracted from config.ts)
│   ├── tags.ts                      # Git identity / tag resolution (from services/tags.ts, modified)
│   ├── privacy.ts                   # Private content stripping (from services/privacy.ts)
│   ├── logger.ts                    # File-based logging (from services/logger.ts)
│   ├── jsonc.ts                     # JSONC parser (from services/jsonc.ts)
│   ├── secret-resolver.ts           # Secret value resolution (from services/secret-resolver.ts)
│   └── types.ts                     # Shared types (from types/index.ts)
│
├── plugin/                          # CLIENT PLUGIN — compiles independently
│   ├── package.json                 # Plugin-specific deps only
│   ├── tsconfig.json                # Compiles only plugin source + shared/
│   ├── src/
│   │   ├── plugin.ts                # ESM entry — remote mode ONLY
│   │   ├── index-remote.ts          # Remote plugin implementation
│   │   └── services/
│   │       └── remote-client.ts     # HTTP client for server API
│   ├── dist/
│   │   └── opencode-memnet.js       # SINGLE bundled output file
│   └── build.ts                     # bun build script
│
├── src/                             # SERVER — keeps existing structure
│   ├── server.ts                    # Standalone headless server
│   ├── server-config.ts             # Server env-var config
│   ├── config.ts                    # Server config (simplified, shared code removed)
│   ├── index.ts                     # DEPRECATED — kept for reference, not shipped in plugin
│   ├── types/
│   │   └── index.ts
│   ├── web/
│   │   └── ...                      # WebUI static files
│   └── services/
│       ├── ...                      # All server services remain here
│       └── ...                      # (storage, ai, embedding, etc.)
│
├── tests/
├── package.json                     # Root — server build + orchestration
├── tsconfig.json                    # Root — server compilation
├── Dockerfile
├── docker-compose.yml
├── scripts/
│   ├── install-client.sh            # Quickstart client install script
│   └── install-server.sh            # Quickstart server install script
└── README.md                        # Updated with separate install sections
```

### 3.2 File Inventory — Plugin (`plugin/`)

| File                                   | Source                          | Lines | Notes                                               |
| -------------------------------------- | ------------------------------- | ----- | --------------------------------------------------- |
| `plugin/src/plugin.ts`                 | New (~15 lines)                 | ~15   | Simplified: only loads remote mode                  |
| `plugin/src/index-remote.ts`           | `src/index-remote.ts`           | 284   | Import paths updated to `../../shared/`             |
| `plugin/src/services/remote-client.ts` | `src/services/remote-client.ts` | 239   | Import paths updated                                |
| `plugin/package.json`                  | New                             | ~30   | Only `@opencode-ai/plugin`, `@opencode-ai/sdk` deps |
| `plugin/tsconfig.json`                 | New                             | ~25   | Includes `src/` and `../../shared/`                 |
| `plugin/build.ts`                      | New                             | ~20   | `bun build --bundle` script                         |

### 3.3 File Inventory — Shared (`shared/`)

| File                        | Source                                       | Lines | Notes                                                                                                                          |
| --------------------------- | -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `shared/client-config.ts`   | Extracted from `src/config.ts` lines 630-714 | ~100  | `ClientConfig`, `CLIENT_DEFAULTS`, `buildClientConfig`, `initClientConfig`, `isClientConfigured`                               |
| `shared/tags.ts`            | `src/services/tags.ts` modified              | ~200  | Import from `./client-config.js` instead of `../config.js`; uses `CLIENT_CONFIG.containerTagPrefix` or accepts config as param |
| `shared/privacy.ts`         | `src/services/privacy.ts`                    | 8     | No changes needed                                                                                                              |
| `shared/logger.ts`          | `src/services/logger.ts`                     | 64    | No changes needed                                                                                                              |
| `shared/jsonc.ts`           | `src/services/jsonc.ts`                      | 129   | No changes needed                                                                                                              |
| `shared/secret-resolver.ts` | `src/services/secret-resolver.ts`            | 68    | No changes needed                                                                                                              |
| `shared/types.ts`           | `src/types/index.ts`                         | 20    | No changes needed                                                                                                              |

### 3.4 File Inventory — Server (`src/`)

All server files remain in `src/` with minimal changes:

- `src/config.ts`: Remove `ClientConfig`, `CLIENT_CONFIG`, `initClientConfig`, `isClientConfigured` (lines 630-714) — these move to `shared/client-config.ts`
- `src/services/tags.ts`: Replaced by import from `../shared/tags.js` OR keep a copy that imports from `../config.js` (server uses full `CONFIG`)
- All other server files: unchanged

### 3.5 Dependency Mapping

**Plugin npm dependencies** (`plugin/package.json`):

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.3.0",
    "@opencode-ai/sdk": "^1.3.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.8",
    "typescript": "^5.7.3"
  }
}
```

**Server npm dependencies** (`package.json` root):

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.3.0",
    "@opencode-ai/sdk": "^1.3.0",
    "franc-min": "^6.2.0",
    "iso-639-3": "^3.0.1",
    "postgres": "^3.4.9",
    "zod": "^4.3.6"
  }
}
```

---

## 4. Build System Changes

### 4.1 Plugin Build

The plugin compiles with `bun build --bundle` to produce a single self-contained JS file.

**Build command**:

```bash
bun build plugin/src/plugin.ts --outdir plugin/dist --target=bun --format=esm
```

**Expected output**: `plugin/dist/opencode-memnet.js` — a single bundled ESM file containing:

- All plugin source code
- All shared utility code (inlined by bundler)
- No node_modules inlined (runtime deps `@opencode-ai/plugin`, `@opencode-ai/sdk` are external)
- Node.js built-ins (`node:fs`, `node:crypto`, etc.) are external

**Build script** (`plugin/build.ts`):

```typescript
import { build } from "bun";

const result = await build({
  entrypoints: ["plugin/src/plugin.ts"],
  outdir: "plugin/dist",
  target: "bun",
  format: "esm",
  naming: "[name].js",
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

**Alternative**: Since the build script references `plugin/` paths from root, it can be a root-level script. Or the `plugin/` directory can have its own `build.ts` that references `../../shared/`.

### 4.2 Plugin `tsconfig.json`

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

Note: `rootDir` is `..` so that `../shared/` imports resolve. The `bun build --bundle` will handle the actual output; `tsc` is used only for type-checking.

### 4.3 Plugin `package.json`

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
  "files": ["dist", "package.json"]
}
```

### 4.4 Server Build (Root)

The server build remains largely the same — `bunx tsc` compiles `src/` to `dist/`.

**Root `package.json` changes**:

```json
{
  "name": "opencode-memnet-server",
  "version": "3.0.0",
  "description": "Standalone memory server for OpenCode persistent AI memory",
  "scripts": {
    "build": "bunx tsc && mkdir -p dist/web && cp -r src/web/* dist/web/",
    "build:plugin": "cd plugin && bun run build",
    "build:all": "bun run build && bun run build:plugin",
    "start:server": "bun run dist/server.js",
    "dev:server": "bun run --watch src/server.ts",
    "typecheck": "bunx tsc --noEmit",
    "typecheck:plugin": "cd plugin && bun run typecheck",
    "typecheck:all": "bun run typecheck && bun run typecheck:plugin"
  },
  "exports": {
    "./server": {
      "import": "./dist/server.js"
    }
  },
  "files": ["dist", "package.json"]
}
```

Key changes:

- Removed `"."` export (plugin is now in `plugin/`)
- Added `build:plugin`, `build:all`, `typecheck:plugin`, `typecheck:all` scripts
- Removed `"main"` field (server is not a library)
- Removed `"types"` field
- Renamed from `opencode-memnet` to `opencode-memnet-server` (optional — can keep same name for backward compat if publishing as a monorepo)

### 4.5 Root `tsconfig.json` Changes

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
    "noUnusedParameters": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "plugin"]
}
```

Key change: `"exclude"` now includes `"plugin"` to prevent tsc from compiling plugin source.

---

## 5. Shared Code Strategy

### 5.1 Decision: Option C — `shared/` Directory

**Rationale**:

- Avoids code duplication (Option A)
- Works reliably across build tools and OS (Option B symlinks are fragile)
- Both plugin and server import from `shared/` using relative paths
- `bun build --bundle` inlines shared code into the plugin bundle automatically
- Server tsc compiles shared code (if included in root tsconfig paths) or imports at runtime

### 5.2 Import Path Strategy

**Plugin source** imports shared utilities using relative paths:

```typescript
// plugin/src/index-remote.ts
import { getTags } from "../../shared/tags.js";
import { CLIENT_CONFIG, initClientConfig, isClientConfigured } from "../../shared/client-config.js";
```

**Server source** imports shared utilities using relative paths:

```typescript
// src/services/some-service.ts (if it needs shared code)
import { log } from "../shared/logger.js";
```

However, for the **server**, most shared utilities are ALREADY duplicated in purpose — the server uses `CONFIG` (full config) while the plugin uses `CLIENT_CONFIG` (client-only). The shared files serve these purposes:

| Shared File                 | Plugin Usage                                              | Server Usage                                                         |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `shared/client-config.ts`   | **Primary** — reads client config files                   | NOT used by server                                                   |
| `shared/tags.ts`            | **Primary** — tag generation using `CLIENT_CONFIG` fields | Server uses its own copy from `src/services/tags.ts` (uses `CONFIG`) |
| `shared/privacy.ts`         | Used by plugin                                            | Server doesn't use directly                                          |
| `shared/logger.ts`          | Used by plugin                                            | Server already imports from `src/services/logger.js`                 |
| `shared/jsonc.ts`           | Used by client-config parser                              | Used by server config parser                                         |
| `shared/secret-resolver.ts` | Used by client-config                                     | Used by server-config                                                |
| `shared/types.ts`           | Type imports                                              | Type imports                                                         |

### 5.3 Tags.ts Dual-Usage Solution

`tags.ts` currently imports `CONFIG` from `config.js` and uses `CONFIG.containerTagPrefix`, `CONFIG.userEmailOverride`, `CONFIG.userNameOverride`.

**Solution**: The shared `tags.ts` accepts a config parameter instead of importing a global:

```typescript
// shared/tags.ts
export interface TagsConfig {
  containerTagPrefix: string;
  userEmailOverride?: string;
  userNameOverride?: string;
}

// Plugin passes CLIENT_CONFIG-derived values
// Server passes CONFIG-derived values
export async function getUserTagInfo(config: TagsConfig): Promise<TagInfo> {
  const email = config.userEmailOverride || (await getGitEmail());
  // ...
}
```

Alternatively, keep `tags.ts` in `src/services/` for the server (it works as-is), and create a client-specific version in `shared/tags.ts` that accepts `CLIENT_CONFIG` fields. The cleaner approach is the parameterized version above.

**Recommended approach**: Parameterize `getTags()` to accept a `TagsConfig` object. The plugin passes values from `CLIENT_CONFIG`, the server passes values from `CONFIG`. This is the cleanest separation.

### 5.4 Config.ts Split Detail

`src/config.ts` (872 lines) splits into:

**`shared/client-config.ts`** (~100 lines) — extracted from lines 630-714:

```typescript
// Contains:
// - ClientConfig interface (lines 632-648)
// - CLIENT_DEFAULTS (lines 650-666)
// - buildClientConfig() (lines 668-691)
// - CLIENT_CONFIG singleton (line 693)
// - initClientConfig() (lines 695-710)
// - isClientConfigured() (lines 712-714)
// Plus needed imports from shared/jsonc.js and shared/secret-resolver.js
// Plus helper: loadConfigFromPaths() (needs jsonc, fs, path)
// Plus helper: expandPath()
// Plus constants: CONFIG_DIR, CONFIG_FILES
```

**`src/config.ts`** (~770 lines) — server config, with client-specific code removed:

- Remove lines 630-714 (`ClientConfig`, `CLIENT_CONFIG`, `initClientConfig`, `isClientConfigured`)
- Keep everything else (full `OpenCodeMemConfig`, `DEFAULTS`, `buildConfig`, `CONFIG`, `initConfig`, etc.)
- `loadConfigFromPaths()` stays in server config (or is duplicated in shared — it's small)
- Server config can import `stripJsoncComments` from `../shared/jsonc.js` and `resolveSecretValue` from `../shared/secret-resolver.js` to avoid duplication

---

## 6. New Plugin Entry Point

### 6.1 `plugin/src/plugin.ts` (New)

The plugin entry is simplified — no mode detection, no legacy fallback:

```typescript
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

**Key differences from current `plugin.ts`**:

- No `package.json` import for ID (hardcoded string)
- No legacy `index.js` fallback
- Import paths go to `../../shared/` and `./index-remote.js`
- Returns empty object `{}` if not configured (graceful no-op)

### 6.2 `plugin/src/index-remote.ts` Import Changes

Current imports → new imports:

```typescript
// BEFORE:
import { remoteMemoryClient } from "./services/remote-client.js";
import { getTags } from "./services/tags.js";
import { stripPrivateContent, isFullyPrivate } from "./services/privacy.js";
import { isClientConfigured, CLIENT_CONFIG, initClientConfig } from "./config.js";
import { log } from "./services/logger.js";

// AFTER:
import { remoteMemoryClient } from "./services/remote-client.js";
import { getTags } from "../../shared/tags.js";
import { stripPrivateContent, isFullyPrivate } from "../../shared/privacy.js";
import { isClientConfigured, CLIENT_CONFIG, initClientConfig } from "../../shared/client-config.js";
import { log } from "../../shared/logger.js";
```

### 6.3 `plugin/src/services/remote-client.ts` Import Changes

```typescript
// BEFORE:
import { CLIENT_CONFIG } from "../config.js";
import { log } from "./logger.js";

// AFTER:
import { CLIENT_CONFIG } from "../../shared/client-config.js";
import { log } from "../../shared/logger.js";
```

---

## 7. Deprecation Plan

### 7.1 What Gets Deprecated

| Item                                    | Current Location | Action                                                                                                          |
| --------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| In-process mode (`index.ts`)            | `src/index.ts`   | Keep in `src/` for reference but do NOT ship in plugin. Add `@deprecated` JSDoc. Remove from any build targets. |
| Legacy fallback in `plugin.ts`          | `src/plugin.ts`  | Removed entirely. New `plugin/src/plugin.ts` only loads remote mode.                                            |
| `CONFIG` global (full config) in plugin | `src/config.ts`  | Plugin no longer imports `CONFIG`. Uses `CLIENT_CONFIG` only.                                                   |

### 7.2 Migration Path for Users

Users currently running in-process mode (no `serverUrl`/`apiKey` configured) will see:

1. Plugin loads → no `serverUrl`/`apiKey` found → warning message printed
2. Plugin returns empty hooks (no-op behavior)
3. User must set up a server and configure `serverUrl`/`apiKey`

This is a **breaking change** for in-process users. The major version bump to 3.0.0 signals this.

---

## 8. Quickstart Scripts

### 8.1 Client Install Script (`scripts/install-client.sh`)

**Constraint**: Non-interactive — `curl | bash` cannot use `read -p`. All config via environment variables or CLI flags.

```bash
#!/usr/bin/env bash
# install-client.sh — Install opencode-memnet plugin for OpenCode
# Usage: curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-client.sh | bash
# Or with env vars:
#   OPENCODE_MEM_SERVER_URL=http://localhost:4747 OPENCODE_MEM_API_KEY=my-key bash install-client.sh

set -euo pipefail

SERVER_URL="${OPENCODE_MEM_SERVER_URL:-http://localhost:4747}"
API_KEY="${OPENCODE_MEM_API_KEY:-}"
CONFIG_DIR="${HOME}/.config/opencode"
CONFIG_FILE="${CONFIG_DIR}/opencode-memnet.jsonc"

# Ensure config directory exists
mkdir -p "${CONFIG_DIR}"

# Write config (merge if exists)
if [ -f "${CONFIG_FILE}" ]; then
  echo "[opencode-memnet] Config already exists at ${CONFIG_FILE}"
  echo "[opencode-memnet] Ensuring serverUrl and apiKey are set..."
  # Use a simple approach: write a .json (not .jsonc) that takes precedence
  JSON_FILE="${CONFIG_DIR}/opencode-memnet.json"
  cat > "${JSON_FILE}" << EOF
{
  "serverUrl": "${SERVER_URL}",
  "apiKey": "${API_KEY}",
  "autoCaptureEnabled": true,
  "showAutoCaptureToasts": true
}
EOF
  echo "[opencode-memnet] Updated ${JSON_FILE}"
else
  cat > "${CONFIG_FILE}" << EOF
{
  // opencode-memnet client configuration
  "serverUrl": "${SERVER_URL}",
  "apiKey": "${API_KEY}",
  "autoCaptureEnabled": true,
  "showAutoCaptureToasts": true
}
EOF
  echo "[opencode-memnet] Created ${CONFIG_FILE}"
fi

# Install plugin via bun
echo "[opencode-memnet] Installing plugin..."
bun add -g opencode-memnet-plugin 2>/dev/null || \
  echo "[opencode-memnet] If installing from source, run: cd plugin && bun install && bun run build"

echo "[opencode-memnet] Client installed. Configure serverUrl and apiKey in:"
echo "  ${CONFIG_FILE}"
```

### 8.2 Server Install Script (`scripts/install-server.sh`)

```bash
#!/usr/bin/env bash
# install-server.sh — Install opencode-memnet server via Docker Compose
# Usage: curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-server.sh | bash
# Env vars (all required unless noted):
#   EMBEDDING_API_URL     — Embedding API endpoint (e.g., https://api.openai.com/v1)
#   EMBEDDING_MODEL       — Embedding model name (e.g., text-embedding-3-small)
#   EMBEDDING_API_KEY     — API key for embedding service
#   SERVER_API_KEY        — Secret key for server authentication
#   MEMORY_MODEL          — (optional) Chat model for auto-capture
#   MEMORY_API_URL        — (optional) Chat API URL
#   MEMORY_API_KEY        — (optional) Chat API key
#   SERVER_PORT           — (optional) Port, default 4747

set -euo pipefail

: "${EMBEDDING_API_URL:?EMBEDDING_API_URL is required}"
: "${EMBEDDING_MODEL:?EMBEDDING_MODEL is required}"
: "${EMBEDDING_API_KEY:?EMBEDDING_API_KEY is required}"
: "${SERVER_API_KEY:?SERVER_API_KEY is required}"

INSTALL_DIR="${OPENCODE_MEM_INSTALL_DIR:-${HOME}/.opencode-memnet-server}"
SERVER_PORT="${SERVER_PORT:-4747}"

echo "[opencode-memnet] Installing server to ${INSTALL_DIR}..."

# Clone repo (shallow)
if [ ! -d "${INSTALL_DIR}/.git" ]; then
  git clone --depth 1 https://github.com/tickernelz/opencode-mem.git "${INSTALL_DIR}"
else
  echo "[opencode-memnet] Repository already exists, pulling latest..."
  git -C "${INSTALL_DIR}" pull --ff-only
fi

cd "${INSTALL_DIR}"

# Create .env file
cat > .env << EOF
EMBEDDING_API_URL=${EMBEDDING_API_URL}
EMBEDDING_MODEL=${EMBEDDING_MODEL}
EMBEDDING_API_KEY=${EMBEDDING_API_KEY}
SERVER_API_KEY=${SERVER_API_KEY}
MEMORY_MODEL=${MEMORY_MODEL:-}
MEMORY_API_URL=${MEMORY_API_URL:-}
MEMORY_API_KEY=${MEMORY_API_KEY:-}
EOF

# Start services
docker compose up -d

echo "[opencode-memnet] Server starting on http://localhost:${SERVER_PORT}"
echo "[opencode-memnet] WebUI: http://localhost:${SERVER_PORT}/"
echo "[opencode-memnet] Health: http://localhost:${SERVER_PORT}/api/health"
echo ""
echo "[opencode-memnet] To view logs: docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
echo "[opencode-memnet] To stop: docker compose -f ${INSTALL_DIR}/docker-compose.yml down"
```

### 8.3 `curl | bash` One-Liners

```bash
# Client install:
curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-client.sh \
  | OPENCODE_MEM_SERVER_URL=http://myserver:4747 OPENCODE_MEM_API_KEY=my-secret bash

# Server install:
curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-server.sh \
  | EMBEDDING_API_URL=https://api.openai.com/v1 \
    EMBEDDING_MODEL=text-embedding-3-small \
    EMBEDDING_API_KEY=sk-... \
    SERVER_API_KEY=my-secret \
    bash
```

---

## 9. README Updates

### 9.1 New README Structure

````markdown
# opencode-memnet

Persistent memory system for AI coding agents — server + client architecture.

## Architecture

[Updated diagram showing plugin/ and server/ as separate components]

## Quick Start

### 1. Install the Server (Docker)

[curl | bash one-liner for server]

### 2. Install the Client Plugin

[curl | bash one-liner for client]

### 3. Configure

[Minimal config example]

## Server Installation

### Docker Compose (recommended)

[docker-compose instructions with env vars]

### Manual (Bun)

[manual server start instructions]

### Environment Variables

[Server env var table — same as current]

## Client Plugin Installation

### Automatic (curl)

[curl one-liner]

### Manual

[manual config file creation]

### Plugin Configuration

[Client config reference — serverUrl, apiKey, autoCaptureEnabled, etc.]

## API Endpoints

[Same as current]

## WebUI

[Same as current]

## Development

### Prerequisites

- Bun >= 1.x

### Setup

```bash
bun install
```
````

### Build

```bash
bun run build:all        # Build server + plugin
bun run build            # Build server only
bun run build:plugin     # Build plugin only
```

### Develop

```bash
bun run dev:server       # Server with hot reload
bun run typecheck:all    # Type-check everything
```

### Test

```bash
bun test
```

## Architecture Details

### Directory Layout

[Tree showing plugin/, shared/, src/]

### Plugin Bundle

The client plugin compiles to a single JS file (plugin/dist/opencode-memnet.js)
that can be loaded directly by OpenCode without any server-side dependencies.

## License

MIT

````

---

## 10. Dockerfile Updates

### 10.1 Server Dockerfile

The Dockerfile should only build the server, not the plugin:

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY shared/ ./shared/
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
````

Note: `shared/` is copied into the builder so the server can import from it if needed.

---

## 11. Git Strategy

### 11.1 Branch

All work on branch `feat/plugin-separation` from `main`.

### 11.2 Commit Sequence

| #   | Commit Message                                            | Scope                                                      |
| --- | --------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | `feat: create shared/ directory with extracted utilities` | Create `shared/`, move/copy files                          |
| 2   | `feat: create plugin/ directory with client-only code`    | Create `plugin/`, move client files                        |
| 3   | `feat: update import paths in plugin source`              | Fix all imports in plugin/                                 |
| 4   | `feat: parameterize tags.ts for dual usage`               | Modify shared/tags.ts to accept config                     |
| 5   | `feat: add plugin build system (bun build --bundle)`      | plugin/package.json, plugin/tsconfig.json, plugin/build.ts |
| 6   | `feat: update server config to remove client code`        | Clean src/config.ts                                        |
| 7   | `feat: update root build system for dual compilation`     | Root package.json, tsconfig.json                           |
| 8   | `feat: deprecate in-process mode, simplify plugin entry`  | New plugin/src/plugin.ts                                   |
| 9   | `feat: add quickstart install scripts`                    | scripts/install-client.sh, scripts/install-server.sh       |
| 10  | `docs: rewrite README for separated architecture`         | README.md                                                  |
| 11  | `chore: update Dockerfile for server-only build`          | Dockerfile                                                 |
| 12  | `chore: update docker-compose.yml`                        | docker-compose.yml                                         |
| 13  | `test: verify plugin compiles independently`              | Manual verification                                        |
| 14  | `chore: bump version to 3.0.0`                            | package.json, plugin/package.json                          |

---

## 12. Acceptance Criteria

### 12.1 Plugin Independence

- [ ] `cd plugin && bun install && bun run build` succeeds with NO server source code present
- [ ] `plugin/dist/opencode-memnet.js` is a single file
- [ ] The plugin output contains NO imports of `postgres`, `franc-min`, `iso-639-3`, or `zod`
- [ ] The plugin output contains NO references to `src/server.ts`, `src/services/storage/`, `src/services/embedding.ts`, `src/services/ai/`
- [ ] `plugin/src/plugin.ts` does NOT import `src/index.ts` (legacy mode)

### 12.2 Plugin Functionality

- [ ] Plugin loads in OpenCode without errors
- [ ] `chat.message` hook injects memory context from server
- [ ] `tool.memory` add/search/list/forget/profile operations work via HTTP
- [ ] `session.idle` auto-capture fires to server
- [ ] `session.compacted` restores session memory
- [ ] Graceful no-op when `serverUrl`/`apiKey` not configured

### 12.3 Server Independence

- [ ] `bun run build` compiles server without plugin source present
- [ ] Server starts and serves API endpoints
- [ ] Server connects to PostgreSQL and runs migrations
- [ ] WebUI loads and functions correctly

### 12.4 No Cross-Dependencies

- [ ] No import in `plugin/` references `src/` (except via `shared/`)
- [ ] No import in `src/` references `plugin/`
- [ ] `shared/` files have no dependency on either `plugin/` or `src/`

### 12.5 Build Verification

- [ ] `bun run build:all` builds both server and plugin without errors
- [ ] `bun run typecheck:all` passes with zero errors
- [ ] No TypeScript warnings in either compilation unit
- [ ] `bun test` passes all existing tests

### 12.6 Quickstart Scripts

- [ ] `curl -fsSL <url>/scripts/install-client.sh | bash` runs non-interactively
- [ ] `curl -fsSL <url>/scripts/install-server.sh | bash` runs with required env vars
- [ ] Scripts fail with clear error messages when required env vars are missing
- [ ] Scripts do NOT use `read -p` or any interactive prompts

### 12.7 README

- [ ] README has separate "Server Installation" and "Client Installation" sections
- [ ] Quick start section has working `curl | bash` one-liners
- [ ] Architecture diagram reflects separated structure
- [ ] Development section shows how to build both components

---

## 13. Risk Assessment

### 13.1 Breaking Changes

| Risk                                  | Impact                                            | Mitigation                                       |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| In-process mode removed               | Users without server lose plugin functionality    | Major version bump (3.0.0), clear migration docs |
| Config file format unchanged          | Client config fields are subset of current format | No config migration needed                       |
| `@opencode-ai/plugin` version pinning | Must match OpenCode's expected version            | Test with latest OpenCode release                |

### 13.2 Technical Risks

| Risk                                                                 | Probability | Mitigation                                            |
| -------------------------------------------------------------------- | ----------- | ----------------------------------------------------- |
| `bun build --bundle` inlines too much                                | Low         | Use `external` option for runtime deps                |
| Relative path `../../shared/` breaks bundler                         | Low         | Tested with bun build — works with bundler resolution |
| Server config.ts still imports shared utilities                      | Medium      | Server can keep its own copy or import from shared/   |
| `tags.ts` parameterization adds complexity                           | Low         | Simple interface, clean API                           |
| `loadConfigFromPaths` needed in both client-config and server config | Medium      | Duplicate the ~15-line helper, or extract to shared   |

---

## 14. Out of Scope

- npm publishing workflow (separate task)
- GitHub Actions CI/CD updates (follow-up task)
- Monorepo tooling (turborepo, nx, etc.) — unnecessary for 2 packages
- Plugin hot-reload during development
- Integration test suite for install scripts
- Migration tool for in-process users (manual migration docs suffice)
