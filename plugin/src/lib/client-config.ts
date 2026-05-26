// plugin/src/lib/client-config.ts — Client-only config loading (self-contained copy from shared/)
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
