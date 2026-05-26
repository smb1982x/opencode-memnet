# IMPLEMENTATION PLAN: Plugin-Server Separation

## Document Metadata

- **ID**: PLAN-PLUGIN-SEPARATION
- **Status**: Draft
- **Created**: 2026-05-26
- **Spec**: SPEC-PLUGIN-SEPARATION
- **Design**: DESIGN-PLUGIN-SEPARATION
- **Target Version**: 3.0.0

---

## Prerequisites

- Current codebase compiles: `bun run build` exits 0
- Current tests pass: `bun test` exits 0
- Working on branch `feat/plugin-separation` from `main`

---

## Phase 1: Create `shared/` Directory with Common Utilities

### Step 1.1: Create `shared/` directory and copy unchanged utilities

- **Files created**: `shared/privacy.ts`, `shared/logger.ts`, `shared/jsonc.ts`, `shared/secret-resolver.ts`, `shared/types.ts`
- **Action**: Create `shared/` directory. Copy the following files WITHOUT any import path changes (they are self-contained or only import node built-ins):
  - `src/services/privacy.ts` → `shared/privacy.ts` (8 lines, no imports)
  - `src/services/logger.ts` → `shared/logger.ts` (64 lines, imports only from `fs`, `os`, `path` — note: uses `"fs"` not `"node:fs"`, keep as-is)
  - `src/services/jsonc.ts` → `shared/jsonc.ts` (129 lines, no imports)
  - `src/services/secret-resolver.ts` → `shared/secret-resolver.ts` (68 lines, imports only `node:fs`, `node:path`, `node:os`)
  - `src/types/index.ts` → `shared/types.ts` (20 lines, no imports)
- **Commands**:
  ```bash
  mkdir -p shared
  cp src/services/privacy.ts shared/privacy.ts
  cp src/services/logger.ts shared/logger.ts
  cp src/services/jsonc.ts shared/jsonc.ts
  cp src/services/secret-resolver.ts shared/secret-resolver.ts
  cp src/types/index.ts shared/types.ts
  ```
- **Verify**: Each file exists in `shared/` and has identical content to its source. Spot-check `head -3 shared/privacy.ts` and `head -3 shared/logger.ts`.
- **Commit message**: `feat: create shared/ directory with common utilities`

---

## Phase 2: Extract Client Config to `shared/client-config.ts`

### Step 2.1: Create `shared/client-config.ts` extracted from `src/config.ts`

- **Files created**: `shared/client-config.ts`
- **Action**: Create a new self-contained file extracting the client-only config from `src/config.ts` lines 630-714. This file must:
  1. Import `stripJsoncComments` from `./jsonc.js` (sibling in `shared/`)
  2. NOT import `resolveSecretValue` — client config has no secret resolution
  3. Contain its own `CONFIG_DIR`, `CONFIG_FILES`, `expandPath`, and `loadConfigFromPaths` (duplicated from `src/config.ts` — ~15 lines, small enough to duplicate)
  4. Export: `ClientConfig`, `CLIENT_CONFIG`, `initClientConfig`, `isClientConfigured`, `buildClientConfig`
  5. Include `CLIENT_DEFAULTS` and `buildClientConfig()` (copied from `src/config.ts` lines 650-691)
  6. Include `initClientConfig()` (copied from `src/config.ts` lines 695-710)
  7. Include `isClientConfigured()` (copied from `src/config.ts` lines 712-714)
  8. Ensure `CONFIG_DIR` directory exists on module load (same as `src/config.ts` lines 14-16)
- **Exact content** (from DESIGN-PLUGIN-SEPARATION §4.2, verified against `src/config.ts`):

  ```typescript
  // shared/client-config.ts — Client-only config loading (extracted from src/config.ts)
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

- **Verify**: File exists at `shared/client-config.ts`, has no imports from `../src/` or `../config.js`.
- **Commit message**: `feat: extract client config to shared/client-config.ts`

### Step 2.2: Create `shared/tags.ts` with parameterized `TagsConfig`

- **Files created**: `shared/tags.ts`
- **Action**: Copy `src/services/tags.ts` to `shared/tags.ts` with these changes:
  1. Remove `import { CONFIG } from "../config.js";` (line 4)
  2. Add `export interface TagsConfig` with fields: `containerTagPrefix: string`, `userEmailOverride?: string`, `userNameOverride?: string`
  3. Modify `getUserTagInfo()` to accept `config: TagsConfig` parameter and use `config.containerTagPrefix`, `config.userEmailOverride`, `config.userNameOverride` instead of `CONFIG.*`
  4. Modify `getProjectTagInfo()` to accept `config: TagsConfig` parameter and use `config.containerTagPrefix`
  5. Modify `getTags()` to accept `config: TagsConfig` as second parameter, pass it through to `getUserTagInfo()` and `getProjectTagInfo()`
  6. Keep all other functions unchanged: `sha256`, `getGitEmail`, `getGitName`, `getGitRepoUrl`, `getGitCommonDir`, `getGitTopLevel`, `getProjectRoot`, `getProjectIdentity`, `getProjectName`
  7. Keep `TagInfo` interface and `TagsResult` interface exported unchanged
  8. Keep cache (`cachedTagsByDir`, `CACHE_TTL`) unchanged
- **Exact diff from `src/services/tags.ts`**:
  - Line 4: DELETE `import { CONFIG } from "../config.js";`
  - After `TagInfo` interface (after line 22), ADD:
    ```typescript
    export interface TagsConfig {
      containerTagPrefix: string;
      userEmailOverride?: string;
      userNameOverride?: string;
    }
    ```
  - `getUserTagInfo()` signature: `(): Promise<TagInfo>` → `(config: TagsConfig): Promise<TagInfo>`
    - Inside: `CONFIG.userEmailOverride` → `config.userEmailOverride`, `CONFIG.userNameOverride` → `config.userNameOverride`, `CONFIG.containerTagPrefix` → `config.containerTagPrefix` (3 replacements)
  - `getProjectTagInfo()` signature: `(directory: string)` → `(directory: string, config: TagsConfig)`
    - Inside: `CONFIG.containerTagPrefix` → `config.containerTagPrefix` (1 replacement)
  - `getTags()` signature: `(directory: string)` → `(directory: string, config: TagsConfig)`
    - Inside: `getUserTagInfo()` → `getUserTagInfo(config)`, `getProjectTagInfo(directory)` → `getProjectTagInfo(directory, config)`
- **Verify**: `shared/tags.ts` has no import of `config.js` or `CONFIG`. `grep -c "CONFIG" shared/tags.ts` returns 0. `grep -c "TagsConfig" shared/tags.ts` returns 5+ (interface definition + function signatures).
- **Commit message**: `feat: add parameterized shared/tags.ts with TagsConfig interface`

---

## Phase 3: Create `plugin/` Directory

### Step 3.1: Create `plugin/` directory structure

- **Files created**: `plugin/`, `plugin/src/`, `plugin/src/services/`
- **Action**: Create the directory skeleton.
- **Commands**:
  ```bash
  mkdir -p plugin/src/services
  ```
- **Verify**: `ls -la plugin/src/services/` shows empty directory.
- **Commit message**: (combined with Step 3.2)

### Step 3.2: Create `plugin/package.json`

- **Files created**: `plugin/package.json`
- **Action**: Write the following content:
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
- **Verify**: `cat plugin/package.json | python3 -m json.tool` exits 0 (valid JSON).
- **Commit message**: (combined with Step 3.5)

### Step 3.3: Create `plugin/tsconfig.json`

- **Files created**: `plugin/tsconfig.json`
- **Action**: Write the following content:
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
- **Verify**: Valid JSON. `rootDir` is `".."`, `include` has both `src/**/*` and `../shared/**/*`.
- **Commit message**: (combined with Step 3.5)

### Step 3.4: Create `plugin/build.ts`

- **Files created**: `plugin/build.ts`
- **Action**: Write the following content:

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

- **Verify**: File exists at `plugin/build.ts`.
- **Commit message**: (combined with Step 3.5)

### Step 3.5: Move and update `plugin/src/services/remote-client.ts`

- **Files created**: `plugin/src/services/remote-client.ts`
- **Files referenced**: `src/services/remote-client.ts` (copied, not moved — server's `src/services/remote-client.ts` stays)
- **Action**: Copy `src/services/remote-client.ts` to `plugin/src/services/remote-client.ts` and update imports:
  - Change `import { CLIENT_CONFIG } from "../config.js";` → `import { CLIENT_CONFIG } from "../../shared/client-config.js";`
  - Change `import { log } from "./logger.js";` → `import { log } from "../../shared/logger.js";`
- **Verify**: `grep -c "config.js" plugin/src/services/remote-client.ts` returns 0 (old import gone). `grep "shared/client-config" plugin/src/services/remote-client.ts` shows the new import.
- **Commit message**: `feat: create plugin/ directory with package.json, tsconfig, build script, and remote-client`

### Step 3.6: Move and update `plugin/src/index-remote.ts`

- **Files created**: `plugin/src/index-remote.ts`
- **Files referenced**: `src/index-remote.ts` (copied, not moved — server keeps `src/index-remote.ts`)
- **Action**: Copy `src/index-remote.ts` to `plugin/src/index-remote.ts` and update ALL imports:
  1. `import { remoteMemoryClient } from "./services/remote-client.js";` → KEEP AS-IS (relative to plugin/src/)
  2. `import { getTags } from "./services/tags.js";` → `import { getTags } from "../../shared/tags.js";`
  3. `import { stripPrivateContent, isFullyPrivate } from "./services/privacy.js";` → `import { stripPrivateContent, isFullyPrivate } from "../../shared/privacy.js";`
  4. `import { isClientConfigured, CLIENT_CONFIG, initClientConfig } from "./config.js";` → `import { isClientConfigured, CLIENT_CONFIG, initClientConfig } from "../../shared/client-config.js";`
  5. `import { log } from "./services/logger.js";` → `import { log } from "../../shared/logger.js";`
  6. Add new import: `import { type TagsConfig } from "../../shared/tags.js";`
  7. Add constant after imports:
     ```typescript
     // NOTE: Must match src/config.ts DEFAULTS.containerTagPrefix — if server changes this, update both places.
     const TAGS_CONFIG: TagsConfig = {
       containerTagPrefix: "opencode",
       userEmailOverride: undefined,
       userNameOverride: undefined,
     };
     ```
  8. Change call: `const tags = await getTags(directory);` → `const tags = await getTags(directory, TAGS_CONFIG);`
- **Verify**:
  - `grep -c "services/tags.js" plugin/src/index-remote.ts` returns 0
  - `grep -c "services/privacy.js" plugin/src/index-remote.ts` returns 0
  - `grep -c "services/logger.js" plugin/src/index-remote.ts` returns 0
  - `grep -c '"./config.js"' plugin/src/index-remote.ts` returns 0
  - `grep "shared/" plugin/src/index-remote.ts` shows 4 imports (client-config, tags, privacy, logger)
  - `grep "TAGS_CONFIG" plugin/src/index-remote.ts` shows definition + usage
- **Commit message**: `feat: add index-remote.ts to plugin with updated imports`

### Step 3.7: Create new `plugin/src/plugin.ts` (remote-only entry)

- **Files created**: `plugin/src/plugin.ts`
- **Action**: Write the following content:

  ```typescript
  // plugin/src/plugin.ts — Remote-mode ONLY entry point
  import type { PluginModule } from "@opencode-ai/plugin";

  export const id = "opencode-memnet";

  async function resolvePlugin() {
    const { initClientConfig, isClientConfigured } = await import("../../shared/client-config.js");
    // First init with cwd for default config gating. index-remote.ts re-inits with correct ctx.directory for actual config loading.
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

- **Verify**: File has NO import of `./index.js` (legacy). No import of `package.json`. Only imports are `@opencode-ai/plugin` (type-only), `../../shared/client-config.js`, and `./index-remote.js`.
- **Commit message**: `feat: add new plugin entry point (remote-only, no legacy fallback)`

---

## Phase 4: Update Root Build System and Config

### Step 4.1: Update root `tsconfig.json` to exclude `plugin/`

- **Files modified**: `tsconfig.json`
- **Action**: Change the `exclude` array from `["node_modules", "dist"]` to `["node_modules", "dist", "plugin"]`.
- **Exact change**:
  ```json
  "exclude": ["node_modules", "dist", "plugin"]
  ```
- **Verify**: `grep '"plugin"' tsconfig.json` returns 1 match in the exclude array.
- **Commit message**: `feat: exclude plugin/ from root tsconfig`

### Step 4.2: Update root `package.json`

- **Files modified**: `package.json`
- **Action**: Make these changes to `package.json`:
  1. `"name"`: `"opencode-memnet"` → `"opencode-memnet-server"`
  2. `"description"`: Update to `"Standalone memory server for OpenCode persistent AI memory"`
  3. Remove `"main"` field (line 6: `"main": "dist/plugin.js"`)
  4. Remove `"types"` field (line 7: `"types": "dist/index.d.ts"`)
  5. Remove `"opencode"` field (lines 62-68) — server is not a plugin
  6. Update `"exports"`: Remove the `"."` export (lines 9-12). Keep only `"./server"`.
     ```json
     "exports": {
       "./server": {
         "import": "./dist/server.js"
       }
     }
     ```
  7. Update `"scripts"`: Add new scripts:
     ```json
      "build:plugin": "cd plugin && bun run build",
      "build:all": "bun run build && bun run build:plugin",
      "dev:plugin": "cd plugin && bun run build",
      "typecheck:plugin": "cd plugin && bun run typecheck",
      "typecheck:all": "bun run typecheck && bun run typecheck:plugin"
     ```
  8. Update `"keywords"`: Replace with server-focused keywords:
     ```json
     "keywords": ["opencode", "memory", "server", "vector-database", "ai", "postgres", "pgvector"]
     ```
  9. Bump `"version"`: `"2.14.3"` → `"3.0.0"`
  10. `"files"`: Keep as `["dist", "package.json"]`
- **Verify**: `cat package.json | python3 -m json.tool` exits 0. `grep '"main"' package.json` returns 0 (removed). `grep '"types"' package.json` returns 0 (removed). `grep '"opencode"' package.json` returns 0 (removed). `grep 'build:plugin' package.json` returns 1.
- **Post-Edit Action**: Run `bun install` from the repo root after editing `package.json` to update the lockfile.
- **Commit message**: `feat: update root package.json for server-only role with plugin build scripts`

### Step 4.3: Install plugin dependencies

- **Action**: Run `bun install` inside the plugin directory.
- **Commands**:
  ```bash
  cd plugin && bun install
  ```
- **Verify**: `plugin/node_modules/@opencode-ai/plugin` exists. `plugin/node_modules/@opencode-ai/sdk` exists. `plugin/bun.lock` or `plugin/bun.lockb` exists.
- **Commit message**: (combined with verification commit)

---

## Phase 5: Clean Server Config and Deprecate Legacy Files

### Step 5.1: Add `@deprecated` annotations to client config exports in `src/config.ts`

- **Files modified**: `src/config.ts`
- **Action**: KEEP the client config exports in `src/config.ts` (lines 630-714) but add `@deprecated` JSDoc comments so they are still available to existing `src/` files that import them. The canonical versions are now in `shared/client-config.ts`. Add the following deprecation annotations:
  1. Before `export interface ClientConfig` (line 632): add `/** @deprecated Canonical version is in shared/client-config.ts. Kept for backward compat — excluded from server build in Step 5.2. */`
  2. Before `export let CLIENT_CONFIG` (line 693): add `/** @deprecated Canonical version is in shared/client-config.ts */`
  3. Before `export function initClientConfig` (line 695): add `/** @deprecated Canonical version is in shared/client-config.ts */`
  4. Before `export function isClientConfigured` (line 712): add `/** @deprecated Canonical version is in shared/client-config.ts */`

  **Why not remove them?**: `src/plugin.ts`, `src/index-remote.ts`, and `src/services/remote-client.ts` still import these exports from `src/config.ts`. Removing them would break the server build. Instead, these files will be excluded from the server build in Step 5.2 (added to tsconfig `exclude`). The `@deprecated` tags signal intent while preserving compilation.

- **Verify**: `grep -c "@deprecated" src/config.ts` returns 4. `grep "ClientConfig" src/config.ts` returns positive (still present). `grep "CLIENT_CONFIG" src/config.ts` returns positive (still present). `bunx tsc --noEmit` still passes (the @deprecated exports ensure src/ files still compile).
- **Commit message**: `feat: deprecate client config exports in server config.ts (kept for backward compat)`

- **Post-Step Verification**: Run `bunx tsc --noEmit` from the repo root to confirm the server still compiles. The `@deprecated` exports ensure `src/plugin.ts`, `src/index-remote.ts`, and `src/services/remote-client.ts` can still resolve their imports.

### Step 5.2: Add `@deprecated` annotations to `src/plugin.ts` and `src/index.ts`; exclude from server build

- **Files modified**: `src/plugin.ts`, `src/index.ts`, `tsconfig.json`
- **Action**:
  1. Prepend to `src/plugin.ts` (before existing code):
     ```typescript
     // @deprecated — This file is kept for reference only.
     // The active plugin entry point is now at plugin/src/plugin.ts
     // This file will not be included in any build output.
     ```
  2. Prepend to `src/index.ts` (before existing code):
     ```typescript
     // @deprecated — Legacy in-process mode.
     // This module is kept for reference only. In-process mode is removed in v3.0.0.
     // All users should migrate to server-client mode (plugin/ + server).
     ```
  3. Update `tsconfig.json` `exclude` array to also exclude `src/plugin.ts`, `src/index.ts`, and `src/index-remote.ts` from the server build:
     ```json
     "exclude": ["node_modules", "dist", "plugin", "src/plugin.ts", "src/index.ts", "src/index-remote.ts"]
     ```
- **Verify**: `head -3 src/plugin.ts` shows deprecation notice. `head -3 src/index.ts` shows deprecation notice. After a server build (`bun run build`), verify `ls dist/` does NOT contain `plugin.js`, `index.js`, or `index-remote.js`.
- **Commit message**: `feat: add @deprecated annotations to legacy src/plugin.ts and src/index.ts; exclude from server build`

---

## Phase 6: Verify Builds

### Step 6.0: Run baseline tests

- **Action**: Run `bun test` to establish baseline — confirm all existing tests pass before restructuring.
- **Commands**:
  ```bash
  bun test
  ```
- **Verify**: All tests pass. Note any pre-existing failures for reference.
- **Commit message**: (no commit — verification only)

### Step 6.1: Verify server build

- **Action**: Build the server.
- **Commands**:
  ```bash
  bun run build
  ```
- **Verify**: Exit code 0. `dist/server.js` exists. `dist/web/index.html` exists.
- **Commit message**: (no commit — verification only)

### Step 6.2: Verify plugin build

- **Action**: Build the plugin.
- **Commands**:
  ```bash
  cd plugin && bun install && bun run build
  ```
- **Verify**:
  - Exit code 0
  - `plugin/dist/opencode-memnet.js` exists and is a single file
  - `grep -c "postgres" plugin/dist/opencode-memnet.js` returns 0
  - `grep -c "franc-min" plugin/dist/opencode-memnet.js` returns 0
  - `grep -c "iso-639-3" plugin/dist/opencode-memnet.js` returns 0
  - `grep -c "zod" plugin/dist/opencode-memnet.js` returns 0
  - `grep -c "storage/postgres" plugin/dist/opencode-memnet.js` returns 0
  - `grep -c "services/embedding" plugin/dist/opencode-memnet.js` returns 0
  - `grep -c "services/ai/" plugin/dist/opencode-memnet.js` returns 0
  - `grep -c "src/index.js" plugin/dist/opencode-memnet.js` returns 0
- **Commit message**: (no commit — verification only)

### Step 6.3: Verify `build:all` and `typecheck:all`

- **Commands**:
  ```bash
  bun run build:all
  bun run typecheck:all
  ```
- **Verify**: Both exit code 0.
- **Commit message**: (no commit — verification only)

### Step 6.4: Commit successful verification state

- **Commit message**: `chore: verify plugin compiles independently from server`

### Step 6.5: Run tests after restructuring

- **Action**: Run `bun test` again — confirm no regressions after all changes.
- **Commands**:
  ```bash
  bun test
  ```
- **Verify**: All tests pass (same or better than baseline in Step 6.0). If any tests fail, investigate — they may import from `src/config.ts` client exports (now `@deprecated` but still present).
- **Commit message**: (no commit — verification only)

---

## Phase 7: Write Quickstart Install Scripts

### Step 7.1: Create `scripts/` directory and `scripts/install-client.sh`

- **Files created**: `scripts/install-client.sh`
- **Action**: Create directory `scripts/`. Write the following non-interactive install script:

  ```bash
  #!/usr/bin/env bash
  # scripts/install-client.sh — Install opencode-memnet plugin for OpenCode
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
  cat > "${JSON_FILE}" << 'EOF'
  {
    "serverUrl": "SERVER_URL_VALUE",
    "apiKey": "API_KEY_VALUE",
    "autoCaptureEnabled": true,
    "showAutoCaptureToasts": true
  }
  EOF
  sed -i "s|SERVER_URL_VALUE|${SERVER_URL}|g" "${JSON_FILE}"
  sed -i "s|API_KEY_VALUE|${API_KEY}|g" "${JSON_FILE}"

  echo "[opencode-memnet] Client config written to ${JSON_FILE}"
  echo "[opencode-memnet] Server URL: ${SERVER_URL}"
  echo ""
  echo "[opencode-memnet] Install complete. The plugin will activate on next OpenCode session."
  ```

- **Commands**:
  ```bash
  mkdir -p scripts
  chmod +x scripts/install-client.sh
  ```
- **Verify**: `grep -c "read -p" scripts/install-client.sh` returns 0 (non-interactive). `bash -n scripts/install-client.sh` exits 0 (valid syntax).
- **Commit message**: `feat: add non-interactive client install script`

### Step 7.2: Create `scripts/install-server.sh`

- **Files created**: `scripts/install-server.sh`
- **Action**: Write the following non-interactive server install script:

  ```bash
  #!/usr/bin/env bash
  # scripts/install-server.sh — Install opencode-memnet server via Docker Compose
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
  cat > "${INSTALL_DIR}/.env" << 'EOF'
  EMBEDDING_API_URL=EMBEDDING_API_URL_VALUE
  EMBEDDING_MODEL=EMBEDDING_MODEL_VALUE
  EMBEDDING_API_KEY=EMBEDDING_API_KEY_VALUE
  SERVER_API_KEY=SERVER_API_KEY_VALUE
  SERVER_PORT=SERVER_PORT_VALUE
  MEMORY_MODEL=MEMORY_MODEL_VALUE
  MEMORY_API_URL=MEMORY_API_URL_VALUE
  MEMORY_API_KEY=MEMORY_API_KEY_VALUE
  EOF
  sed -i "s|EMBEDDING_API_URL_VALUE|${EMBEDDING_API_URL}|g" "${INSTALL_DIR}/.env"
  sed -i "s|EMBEDDING_MODEL_VALUE|${EMBEDDING_MODEL}|g" "${INSTALL_DIR}/.env"
  sed -i "s|EMBEDDING_API_KEY_VALUE|${EMBEDDING_API_KEY}|g" "${INSTALL_DIR}/.env"
  sed -i "s|SERVER_API_KEY_VALUE|${SERVER_API_KEY}|g" "${INSTALL_DIR}/.env"
  sed -i "s|SERVER_PORT_VALUE|${SERVER_PORT}|g" "${INSTALL_DIR}/.env"
  sed -i "s|MEMORY_MODEL_VALUE|${MEMORY_MODEL:-}|g" "${INSTALL_DIR}/.env"
  sed -i "s|MEMORY_API_URL_VALUE|${MEMORY_API_URL:-}|g" "${INSTALL_DIR}/.env"
  sed -i "s|MEMORY_API_KEY_VALUE|${MEMORY_API_KEY:-}|g" "${INSTALL_DIR}/.env"

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

- **Commands**:
  ```bash
  chmod +x scripts/install-server.sh
  ```
- **Verify**: `grep -c "read -p" scripts/install-server.sh` returns 0 (non-interactive). `bash -n scripts/install-server.sh` exits 0. `grep -c "EMBEDDING_API_URL" scripts/install-server.sh` returns 3+ (validation + usage).
- **Commit message**: `feat: add non-interactive server install script`

---

## Phase 8: Create `.dockerignore` and Update Dockerfile (if needed)

> **Known Spec Inconsistency**: SPEC §10.1 includes `COPY shared/` but this is superseded by DESIGN §2.2 and §9.1 — the server does NOT need `shared/`. The spec will be updated in a follow-up commit.

### Step 8.1: Create `.dockerignore`

- **Files created**: `.dockerignore`
- **Action**: Create `.dockerignore` to keep Docker build context minimal (server-only):
  ```
  plugin/
  shared/
  scripts/
  tests/
  *.md
  .git/
  .husky/
  node_modules/
  dist/
  .env*
  .gitignore
  SPEC-*.md
  DESIGN-*.md
  PLAN-*.md
  ```
- **Verify**: `.dockerignore` exists and contains `plugin/` and `shared/`.
- **Commit message**: `chore: add .dockerignore to exclude plugin/shared/scripts from Docker build`

### Step 8.2: Verify Dockerfile is unchanged

- **Action**: Review `Dockerfile`. It already only copies `src/` and does NOT need `shared/` (server keeps its own copies of all utilities in `src/services/`). No changes needed.
- **Verify**: `Dockerfile` has `COPY src/ ./src/` and no reference to `shared/` or `plugin/`.
- **Commit message**: (no commit — verification only)

### Step 8.3: Verify `docker-compose.yml` needs no changes

- **Action**: Review `docker-compose.yml`. It references `Dockerfile` for the build and reads environment variables from `.env` file. Both are already addressed (Dockerfile unchanged in Step 8.2, `.env` created by install script in Step 7.2). No changes needed.
- **Verify**: `docker-compose.yml` references `Dockerfile` and `.env` — both are correct. No references to `plugin/` or `shared/`.
- **Commit message**: (no commit — verification only)

---

## Phase 9: Update README.md

### Step 9.1: Rewrite README.md

- **Files modified**: `README.md`
- **Action**: Rewrite README.md to reflect the separated architecture. Structure:

  ````markdown
  # opencode-memnet

  Persistent memory system for AI coding agents — server + client architecture.

  This project builds upon and would not exist without the original
  [OpenCode Memory](https://github.com/tickernelz/opencode-mem) by **tickernelz**.

  ## Architecture

  ![opencode-memnet Architecture Diagram](src/web/opencode-memnet-diagram.svg)

  - **Server** (`src/`): Standalone Bun process serving REST API + WebUI, connected to Postgres/pgvector
  - **Client Plugin** (`plugin/`): Thin OpenCode plugin compiled to a single JS file, communicates via HTTP
  - **Shared** (`shared/`): Utilities used by the plugin (client config, tags, logging)
  - **Storage**: Postgres with pgvector for vector embeddings with HNSW indexing

  ## Quick Start

  ### 1. Install the Server (Docker)

  ```bash
  curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-server.sh \
    | EMBEDDING_API_URL=https://api.openai.com/v1 \
      EMBEDDING_MODEL=text-embedding-3-small \
      EMBEDDING_API_KEY=sk-... \
      SERVER_API_KEY=my-secret \
      bash
  ```
  ````

  ### 2. Configure the Client Plugin

  ```bash
  curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-client.sh \
    | OPENCODE_MEM_SERVER_URL=http://localhost:4747 OPENCODE_MEM_API_KEY=my-secret bash
  ```

  ## Server Installation

  ### Docker Compose (recommended)

  [Same docker-compose instructions as before — clone, set env vars, docker compose up -d]

  ### Manual (Bun)

  [Same manual server start instructions as before]

  ### Environment Variables

  [Same env var table as before — REQUIRED and OPTIONAL sections]

  ## Client Plugin Installation

  ### Automatic (curl)

  [curl one-liner]

  ### Manual Configuration

  Create `.opencode/opencode-memnet.jsonc` in your project:

  ```jsonc
  {
    "serverUrl": "http://localhost:4747",
    "apiKey": "my-secret-key",
    "autoCaptureEnabled": true,
  }
  ```

  ### Plugin Configuration Options

  | Field                               | Default                 | Description                                    |
  | ----------------------------------- | ----------------------- | ---------------------------------------------- |
  | `serverUrl`                         | `http://localhost:4747` | Server URL                                     |
  | `apiKey`                            | —                       | API key (required)                             |
  | `autoCaptureEnabled`                | `true`                  | Enable auto-capture from chat sessions         |
  | `showAutoCaptureToasts`             | `true`                  | Show toast on auto-capture                     |
  | `showErrorToasts`                   | `true`                  | Show error toasts                              |
  | `chatMessage.enabled`               | `true`                  | Inject memory context on chat messages         |
  | `chatMessage.maxMemories`           | `3`                     | Max memories in context injection              |
  | `chatMessage.excludeCurrentSession` | `true`                  | Exclude current session from context           |
  | `chatMessage.maxAgeDays`            | —                       | Max age in days for context memories           |
  | `chatMessage.injectOn`              | `"first"`               | When to inject: `"first"` or `"always"`        |
  | `memory.defaultScope`               | `"project"`             | Default scope: `"project"` or `"all-projects"` |

  ## API Endpoints

  [Same as current README — Health, Memories, Search, User Profiles, Tags & Stats]

  ## WebUI

  [Same as current README]

  ## Development

  ### Prerequisites
  - Bun >= 1.x

  ### Setup

  ```bash
  bun install
  cd plugin && bun install && cd ..
  ```

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

  ```
  opencode-memnet/
  ├── shared/          # Shared utilities (used by plugin only)
  ├── plugin/          # Client plugin — compiles independently
  │   ├── src/         # Plugin source
  │   └── dist/        # Bundled output (single .js file)
  ├── src/             # Server source
  │   ├── services/    # Server services (storage, AI, etc.)
  │   └── web/         # WebUI static files
  ├── scripts/         # Install scripts
  ├── Dockerfile       # Server Docker build
  └── docker-compose.yml
  ```

  ### Plugin Bundle

  The client plugin compiles to a single JS file (`plugin/dist/opencode-memnet.js`)
  that can be loaded directly by OpenCode without any server-side dependencies.

  ## License

  MIT

  ```

  ```

- **Verify**: README has separate "Server Installation" and "Client Plugin Installation" sections. Has `curl | bash` one-liners. Has `build:all` in Development section.
- **Commit message**: `docs: rewrite README for separated plugin-server architecture`

---

## Phase 10: Update `.gitignore`

### Step 10.1: Add plugin/dist/ and plugin/node_modules/ to .gitignore

- **Files modified**: `.gitignore`
- **Action**: Append to `.gitignore`:
  ```
  # plugin build output and dependencies
  plugin/dist
  plugin/node_modules
  ```
- **Verify**: `grep "plugin/dist" .gitignore` returns 1 match.
- **Commit message**: `chore: add plugin/dist and plugin/node_modules to .gitignore`

---

## Phase 11: Final Verification Checklist

### Step 11.1: Plugin Independence

- **Commands**:
  ```bash
  # From root:
  cd plugin && bun install && bun run build
  ```
- **Verify**:
  - [ ] `plugin/dist/opencode-memnet.js` is a single file
  - [ ] `grep -c "postgres" plugin/dist/opencode-memnet.js` → 0
  - [ ] `grep -c "franc-min" plugin/dist/opencode-memnet.js` → 0
  - [ ] `grep -c "iso-639-3" plugin/dist/opencode-memnet.js` → 0
  - [ ] `grep -c "zod" plugin/dist/opencode-memnet.js` → 0
  - [ ] `grep -c "storage/postgres" plugin/dist/opencode-memnet.js` → 0
  - [ ] `grep -c "services/embedding" plugin/dist/opencode-memnet.js` → 0
  - [ ] `grep -c "services/ai/" plugin/dist/opencode-memnet.js` → 0
  - [ ] `grep -c "src/index.js" plugin/dist/opencode-memnet.js` → 0
  - [ ] No import in `plugin/` references `src/` (except via `../../shared/`)
  - [ ] `plugin/src/plugin.ts` does NOT import `src/index.ts`

### Step 11.2: Server Independence

- **Commands**:
  ```bash
  bun run build
  ```
- **Verify**:
  - [ ] `dist/server.js` exists
  - [ ] `dist/web/index.html` exists
  - [ ] `grep -c "plugin/src" dist/server.js` → 0
  - [ ] `grep -c "plugin/" dist/server.js` → 0
  - [ ] No import in `src/` references `plugin/`

### Step 11.3: No Cross-Dependencies

- **Verify**:
  - [ ] `grep -r "from.*['\"].*src/" plugin/src/` → 0 matches (plugin doesn't import from src/)
  - [ ] `grep -r "from.*['\"].*plugin/" src/` → 0 matches (server doesn't import from plugin/)
  - [ ] `grep -r "from.*['\"].*\.\./plugin" shared/` → 0 matches (shared doesn't import from plugin/)
  - [ ] `grep -r "from.*['\"].*\.\./src" shared/` → 0 matches (shared doesn't import from src/)

### Step 11.4: Combined Build

- **Commands**:
  ```bash
  bun run build:all
  bun run typecheck:all
  ```
- **Verify**: Both exit code 0 with zero errors.

### Step 11.5: Quickstart Scripts

- **Verify**:
  - [ ] `bash -n scripts/install-client.sh` exits 0
  - [ ] `bash -n scripts/install-server.sh` exits 0
  - [ ] `grep -c "read -p" scripts/install-client.sh` → 0
  - [ ] `grep -c "read -p" scripts/install-server.sh` → 0

### Step 11.6: Final Commit

- **Commit message**: `chore: bump version to 3.0.0, plugin-server separation complete`

---

## Summary of All Commits (in order)

| #   | Commit Message                                                                                          | Phase |
| --- | ------------------------------------------------------------------------------------------------------- | ----- |
| 1   | `feat: create shared/ directory with common utilities`                                                  | 1     |
| 2   | `feat: extract client config to shared/client-config.ts`                                                | 2     |
| 3   | `feat: add parameterized shared/tags.ts with TagsConfig interface`                                      | 2     |
| 4   | `feat: create plugin/ directory with package.json, tsconfig, build script, and remote-client`           | 3     |
| 5   | `feat: add index-remote.ts to plugin with updated imports`                                              | 3     |
| 6   | `feat: add new plugin entry point (remote-only, no legacy fallback)`                                    | 3     |
| 7   | `feat: exclude plugin/ from root tsconfig`                                                              | 4     |
| 8   | `feat: update root package.json for server-only role with plugin build scripts`                         | 4     |
| 9   | `feat: deprecate client config exports in server config.ts (kept for backward compat)`                  | 5     |
| 10  | `feat: add @deprecated annotations to legacy src/plugin.ts and src/index.ts; exclude from server build` | 5     |
| 11  | `chore: verify plugin compiles independently from server`                                               | 6     |
| 12  | `feat: add non-interactive client install script`                                                       | 7     |
| 13  | `feat: add non-interactive server install script`                                                       | 7     |
| 14  | `chore: add .dockerignore to exclude plugin/shared/scripts from Docker build`                           | 8     |
| 15  | `docs: rewrite README for separated plugin-server architecture`                                         | 9     |
| 16  | `chore: add plugin/dist and plugin/node_modules to .gitignore`                                          | 10    |
| 17  | `chore: bump version to 3.0.0, plugin-server separation complete`                                       | 11    |

---

## Risk Notes for Implementer

1. **`src/config.ts` line numbers may shift**: The line numbers (630-714) reference the current file. If lines are added/removed above during editing, re-verify the correct range. The target code is everything between `// ── Client-only config` comment and the `function validateConfig()` definition.

2. **`plugin/src/services/remote-client.ts` references `CLIENT_CONFIG` at module level** (line 239): The singleton `remoteMemoryClient = getRemoteClient()` calls `getRemoteClient()` which reads `CLIENT_CONFIG.serverUrl` and `CLIENT_CONFIG.apiKey`. This is fine because `initClientConfig()` is called in `plugin.ts` before `index-remote.ts` is loaded, and the dynamic import ensures ordering.

3. **`shared/logger.ts` uses non-`node:` imports** (`"fs"`, `"os"`, `"path"` instead of `"node:fs"`, etc.). Keep as-is — Bun resolves both forms.

4. **`plugin/src/index-remote.ts` line 15** calls `initClientConfig(directory)` again even though `plugin.ts` already calls it. This is harmless (idempotent) but can be optionally removed for cleanliness.

5. **Tests**: Existing tests may import `CLIENT_CONFIG`, `initClientConfig`, or `isClientConfigured` from `src/config.ts`. After Step 5.1, these exports remain in `src/config.ts` with `@deprecated` annotations, so tests will continue to compile. The deprecated exports will be excluded from the server build via Step 5.2's tsconfig exclude. If tests need the canonical versions, update imports to `../shared/client-config.js`.
