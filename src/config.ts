import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./services/jsonc.js";
import { resolveSecretValue } from "./services/secret-resolver.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const DATA_DIR = join(homedir(), ".opencode-mem");
const CONFIG_FILES = [
  join(CONFIG_DIR, "opencode-mem.jsonc"),
  join(CONFIG_DIR, "opencode-mem.json"),
];

if (!existsSync(CONFIG_DIR)) {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

interface OpenCodeMemConfig {
  storagePath?: string;
  userEmailOverride?: string;
  userNameOverride?: string;
  memory?: {
    defaultScope?: "project" | "all-projects";
  };
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingApiUrl?: string;
  embeddingApiKey?: string;
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
  similarityThreshold?: number;
  maxMemories?: number;

  injectProfile?: boolean;
  containerTagPrefix?: string;
  autoCaptureEnabled?: boolean;
  autoCaptureMaxIterations?: number;
  autoCaptureIterationTimeout?: number;
  autoCaptureLanguage?: string;
  memoryProvider?: "openai-chat";
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  aiSessionRetentionDays?: number;
  webServerEnabled?: boolean;
  webServerPort?: number;
  webServerHost?: string;
  webServerAllowedOrigin?: string;
  userProfileAnalysisInterval?: number;
  userProfileMaxPreferences?: number;
  userProfileMaxPatterns?: number;
  userProfileMaxWorkflows?: number;
  userProfileConfidenceDecayDays?: number;
  userProfileChangelogRetentionCount?: number;
  showAutoCaptureToasts?: boolean;
  showUserProfileToasts?: boolean;
  showErrorToasts?: boolean;
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
  compaction?: {
    enabled?: boolean;
    memoryLimit?: number;
  };
  chatMessage?: {
    enabled?: boolean;
    maxMemories?: number;
    excludeCurrentSession?: boolean;
    maxAgeDays?: number;
    injectOn?: "first" | "always";
  };
}

const DEFAULTS: Required<
  Omit<
    OpenCodeMemConfig,
    | "embeddingApiUrl"
    | "embeddingApiKey"
    | "embeddingModel"
    | "memoryModel"
    | "memoryApiUrl"
    | "memoryApiKey"
    | "memoryProvider"
    | "memoryTemperature"
    | "memoryExtraParams"
    | "opencodeProvider"
    | "opencodeModel"
    | "autoCaptureLanguage"
    | "userEmailOverride"
    | "userNameOverride"
    | "webServerAllowedOrigin"
  >
> & {
  embeddingApiUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryProvider?: "openai-chat";
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  autoCaptureLanguage?: string;
  userEmailOverride?: string;
  userNameOverride?: string;
  webServerAllowedOrigin?: string;
  memory?: {
    defaultScope?: "project" | "all-projects";
  };
} = {
  storagePath: join(DATA_DIR, "data"),
  embeddingDimensions: 1024,
  similarityThreshold: 0.6,
  maxMemories: 10,
  injectProfile: true,
  containerTagPrefix: "opencode",
  autoCaptureEnabled: true,
  autoCaptureMaxIterations: 5,
  autoCaptureIterationTimeout: 30000,
  aiSessionRetentionDays: 7,
  webServerEnabled: true,
  webServerPort: 4747,
  webServerHost: "127.0.0.1",
  webServerAllowedOrigin: "*",
  userProfileAnalysisInterval: 10,
  userProfileMaxPreferences: 20,
  userProfileMaxPatterns: 15,
  userProfileMaxWorkflows: 10,
  userProfileConfidenceDecayDays: 30,
  userProfileChangelogRetentionCount: 5,
  showAutoCaptureToasts: true,
  showUserProfileToasts: true,
  showErrorToasts: true,
  postgres: {
    ssl: "require" as const,
    maxConnections: 10,
    idleTimeoutSeconds: 30,
    connectTimeoutSeconds: 10,
    vectorType: "vector" as const,
    hnswEfSearch: 128,
    hnswEfConstruction: 256,
  },
  embeddingMaxTokens: {
    content: 2048,
    tags: 256,
    query: 512,
    migration: 2048,
  },
  embeddingTruncationSide: {
    content: "right" as const,
    tags: "right" as const,
    query: "right" as const,
    migration: "right" as const,
  },
  memory: {
    defaultScope: "project",
  },
  compaction: {
    enabled: true,
    memoryLimit: 10,
  },
  chatMessage: {
    enabled: true,
    maxMemories: 3,
    excludeCurrentSession: true,
    maxAgeDays: undefined,
    injectOn: "first",
  },
};

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

function loadConfigFromPaths(paths: string[]): OpenCodeMemConfig {
  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const json = stripJsoncComments(content);
        return JSON.parse(json) as OpenCodeMemConfig;
      } catch (err) {
        // Log the error instead of silently returning empty config
        console.warn("[config] Failed to parse config file:", path, String(err));
      }
    }
  }
  return {};
}

const CONFIG_TEMPLATE = `{
  // ============================================
  // OpenCode Memory Plugin Configuration
  // ============================================
  //
  // REQUIRED fields (plugin will not start without these):
  //   - embeddingModel   — embedding model name at your API endpoint
  //   - embeddingApiUrl  — OpenAI-compatible embedding API endpoint
  //   - embeddingApiKey  — API key (or set OPENAI_API_KEY env var)
  //   - postgres.url     — PostgreSQL connection URL
  //
  // ============================================

  // General data directory (used for cache, user overrides, etc.)
  "storagePath": "~/.opencode-mem/data",

  "userEmailOverride": "",
  "userNameOverride": "",

  // ============================================
  // Embedding Model (REQUIRED)
  // ============================================

  // REQUIRED: Name of the embedding model at your API endpoint.
  // "embeddingModel": "text-embedding-3-small",

  // REQUIRED: OpenAI-compatible embedding API endpoint.
  // "embeddingApiUrl": "https://api.openai.com/v1",
  // "embeddingApiKey": "sk-...",

  // Embedding vector dimensions (default: 1024, auto-detected for known models).
  // "embeddingDimensions": 1024,

  // Recommended models:
  // "text-embedding-3-small"      // OpenAI, 1536 dims
  // "text-embedding-3-large"      // OpenAI, 3072 dims
  // "text-embedding-ada-002"      // OpenAI, 1536 dims
  // "embed-english-v3.0"          // Cohere, 1024 dims
  // "embed-multilingual-v3.0"     // Cohere, 1024 dims
  // "voyage-3"                    // Voyage AI, 1024 dims
  // "voyage-code-3"               // Voyage AI, 1024 dims

  // ============================================
  // Embedding Input Truncation Settings
  // ============================================

  // Max input tokens per embedding kind (approximate; controls how much text is sent to the
  // embedding model). These do NOT change the output vector dimensions.
  // Approximate: ~4 characters per token.
  // "embeddingMaxTokens": {
  //   "content": 2048,
  //   "tags": 256,
  //   "query": 512,
  //   "migration": 2048
  // },

  // Truncation side: "right" keeps the beginning (app-side), "left" keeps the end.
  // For remote APIs with "left", truncate_prompt_tokens is sent to let the server truncate.
  // "embeddingTruncationSide": {
  //   "content": "right",
  //   "tags": "right",
  //   "query": "right",
  //   "migration": "right"
  // },

  // ============================================
  // PostgreSQL Connection (REQUIRED)
  // ============================================

  // "postgres": {
  //   // Connection URL (supports env:// and file:// secret references)
  //   // "url": "env://DATABASE_URL",
  //   "ssl": "require",
  //   "maxConnections": 10,
  //   "idleTimeoutSeconds": 30,
  //   "connectTimeoutSeconds": 10,
  //   "vectorType": "vector",
  //   "hnswEfSearch": 128,
  //   "hnswEfConstruction": 256
  // },

  // ============================================
  // Web Server Settings
  // ============================================

  // Enable web UI for managing memories (accessible at http://localhost:4747)
  "webServerEnabled": true,

  // Port for web UI server
  "webServerPort": 4747,

  // Host address for web UI (use 127.0.0.1 for local only, 0.0.0.0 for network access)
  "webServerHost": "127.0.0.1",

  // Allowed origin for CORS headers (default: "*" — any origin)
  // Restrict to a specific origin for better security, e.g. "http://localhost:3000"
  // "webServerAllowedOrigin": "*",

  // ============================================
  // Memory Scope Settings
  // ============================================

  // Default scope for memory list/search queries
  // "project" keeps queries within the current project, "all-projects" searches across all project shards
  "memory": {
    "defaultScope": "project"
  },

  // ============================================
  // OpenCode Provider Settings (RECOMMENDED)
  // ============================================

   // Use any provider that is already authenticated in opencode for auto-capture
   // and user profile learning. The plugin calls opencode's session.prompt API
   // (with structured output) instead of talking to provider HTTPS endpoints
   // directly, so opencode owns the auth, token refresh, and provider routing.
   //
   // No separate API key is needed in this plugin — whatever you configured in
   // opencode (OAuth like Claude Pro/Max, GitHub Copilot personal/business,
   // bring-your-own API key, custom provider, ...) just works.
   //
   // If NOT set, falls back to the manual config (memoryApiKey/memoryApiUrl/memoryModel below).
   //
   // Examples (the provider name must be one returned by 'opencode providers list'):
   //   Anthropic (OAuth/API key): "opencodeProvider": "anthropic",      "opencodeModel": "claude-haiku-4-5-20251001"
   //   OpenAI (API key):          "opencodeProvider": "openai",          "opencodeModel": "gpt-4o-mini"
   //   GitHub Copilot:            "opencodeProvider": "github-copilot",  "opencodeModel": "gpt-4o-mini"
   //
   // "opencodeProvider": "anthropic",
   // "opencodeModel": "claude-haiku-4-5-20251001",

   // ============================================
   // Auto-Capture Settings (REQUIRES EXTERNAL API)
   // ============================================

  // IMPORTANT: Auto-capture ONLY works with external API
  // It runs in background without blocking your main session
  // Note: Ollama may not support tool calling. Use OpenAI, Anthropic, or Groq for best results.

  "autoCaptureEnabled": true,

   // Provider type: "openai-chat"
   // Note: "openai-chat" is a generic OpenAI API-compatible mode.
   // Any service that follows the OpenAI Chat Completions API can use it via custom "memoryApiUrl".
  "memoryProvider": "openai-chat",

  // REQUIRED for auto-capture (all 3 must be set):
  "memoryModel": "gpt-4o-mini",
  "memoryApiUrl": "https://api.openai.com/v1",
  "memoryApiKey": "sk-...",

  // API Key Formats:
  // Direct value:        "sk-..."
  // From file:           "file://~/.config/litellm-key.txt"
  // From env variable:   "env://LITELLM_API_KEY"

  // Examples for different providers:
  // Any OpenAI-compatible endpoint can use the "openai-chat" provider pattern below.
  // Common examples: DeepSeek, Qwen (via Alibaba Cloud ModelStudio),
  // Zhipu GLM (BigModel platform), and Kimi (Moonshot AI platform).

  // OpenAI Chat Completion (default, backward compatible):
  //   "memoryProvider": "openai-chat"
  //   "memoryModel": "gpt-4o-mini"
  //   "memoryApiUrl": "https://api.openai.com/v1"
  //   "memoryApiKey": "sk-..."

  // DeepSeek (OpenAI-compatible example):
  //   "memoryProvider": "openai-chat"
  //   "memoryModel": "deepseek-chat"
  //   "memoryApiUrl": "https://api.deepseek.com/v1"
  //   "memoryApiKey": "sk-..."

  // Groq (OpenAI-compatible, use openai-chat provider):
  //   "memoryProvider": "openai-chat"
  //   "memoryModel": "llama-3.3-70b-versatile"
  //   "memoryApiUrl": "https://api.groq.com/openai/v1"
  //   "memoryApiKey": "gsk_..."

  // Maximum iterations for multi-turn AI analysis
  "autoCaptureMaxIterations": 5,

  // Timeout per iteration in milliseconds (30 seconds default)
  "autoCaptureIterationTimeout": 30000,

  // Days to keep AI session history before cleanup
  "aiSessionRetentionDays": 7,

  // Temperature for AI API requests (set to false to omit parameter for models that don't support it)
  // Some reasoning models (like o1, o3, gpt-5) don't support temperature parameter
  // Set to false and add "memoryTemperature": false in config when using such models
  "memoryTemperature": 0.3,

  // Extra parameters to include in API request body
  // Useful for local inference servers (e.g. llama-server with --jinja) that support
  // additional parameters like disabling thinking/reasoning mode
  // Example for Qwen3 models: { "enable_thinking": false }
  // "memoryExtraParams": {},

  // Language for auto-capture summaries (default: "auto" for auto-detection)
  // Options: "auto", "en", "id", "zh", "ja", "es", "fr", "de", "ru", "pt", "ar", "ko"
  // "autoCaptureLanguage": "auto",

  // ============================================
  // Toast Notifications
  // ============================================

  // Show toast when memory is auto-captured
  "showAutoCaptureToasts": true,

  // Show toast when user profile is updated
  "showUserProfileToasts": true,

  // Show toast for error messages
  "showErrorToasts": true,

  // ============================================
  // User Profile System
  // ============================================

  // Analyze user prompts every N prompts to build/update your user profile
  // When N uncaptured prompts accumulate, AI will analyze them to identify:
  // - User preferences (code style, communication style, tool preferences)
  // - User patterns (recurring topics, problem domains, technical interests)
  // - User workflows (development habits, sequences, learning style)
  // - Skill level (overall and per-domain assessment)
  "userProfileAnalysisInterval": 10,

  // Maximum number of preferences to keep in user profile (sorted by confidence)
  // Preferences are things like "prefers code without comments", "likes concise responses"
  "userProfileMaxPreferences": 20,

  // Maximum number of patterns to keep in user profile (sorted by frequency)
  // Patterns are recurring topics like "often asks about database optimization"
  "userProfileMaxPatterns": 15,

  // Maximum number of workflows to keep in user profile (sorted by frequency)
  // Workflows are sequences like "usually asks for tests after implementation"
  "userProfileMaxWorkflows": 10,

  // Days before preference confidence starts to decay (if not reinforced)
  // Preferences that aren't seen again will gradually lose confidence and be removed
  "userProfileConfidenceDecayDays": 30,

  // Number of profile versions to keep in changelog (for rollback/debugging)
  // Older versions are automatically cleaned up
  "userProfileChangelogRetentionCount": 5,

  // ============================================
  // Search Settings
  // ============================================

  // Minimum similarity score (0-1) for memory search results
  "similarityThreshold": 0.6,

  // Maximum number of memories to return in search results
  "maxMemories": 10,

  // ============================================
  // Advanced Settings
  // ============================================

  // Inject user profile into AI context (preferences, patterns, workflows)
  "injectProfile": true
}
`;

function ensureConfigExists(): void {
  const configPath = join(CONFIG_DIR, "opencode-mem.jsonc");

  if (!existsSync(configPath)) {
    try {
      writeFileSync(configPath, CONFIG_TEMPLATE, "utf-8");
      console.log(`\n✓ Created config template: ${configPath}`);
      console.log("  Edit this file to customize opencode-mem settings.\n");
    } catch {}
  }
}

ensureConfigExists();

function getEmbeddingDimensions(model: string): number {
  const dimensionMap: Record<string, number> = {
    // OpenAI API models
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,

    // Cohere API models
    "embed-english-v3.0": 1024,
    "embed-multilingual-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-light-v3.0": 384,

    // Google API models
    "text-embedding-004": 768,
    "text-multilingual-embedding-002": 768,

    // Voyage AI models
    "voyage-3": 1024,
    "voyage-3-lite": 512,
    "voyage-code-3": 1024,
  };
  return dimensionMap[model] || DEFAULTS.embeddingDimensions;
}

function buildConfig(fileConfig: OpenCodeMemConfig) {
  return {
    storagePath: expandPath(fileConfig.storagePath ?? DEFAULTS.storagePath),
    userEmailOverride: fileConfig.userEmailOverride,
    userNameOverride: fileConfig.userNameOverride,
    embeddingModel: fileConfig.embeddingModel,
    embeddingDimensions:
      fileConfig.embeddingDimensions ?? getEmbeddingDimensions(fileConfig.embeddingModel ?? ""),
    embeddingApiUrl: fileConfig.embeddingApiUrl,
    embeddingApiKey: resolveSecretValue(fileConfig.embeddingApiKey ?? process.env.OPENAI_API_KEY),
    similarityThreshold: fileConfig.similarityThreshold ?? DEFAULTS.similarityThreshold,
    maxMemories: fileConfig.maxMemories ?? DEFAULTS.maxMemories,
    injectProfile: fileConfig.injectProfile ?? DEFAULTS.injectProfile,
    containerTagPrefix: fileConfig.containerTagPrefix ?? DEFAULTS.containerTagPrefix,
    autoCaptureEnabled: fileConfig.autoCaptureEnabled ?? DEFAULTS.autoCaptureEnabled,
    autoCaptureMaxIterations:
      fileConfig.autoCaptureMaxIterations ?? DEFAULTS.autoCaptureMaxIterations,
    autoCaptureIterationTimeout:
      fileConfig.autoCaptureIterationTimeout ?? DEFAULTS.autoCaptureIterationTimeout,
    autoCaptureLanguage: fileConfig.autoCaptureLanguage,
    memoryProvider: (fileConfig.memoryProvider ?? "openai-chat") as "openai-chat",
    memoryModel: fileConfig.memoryModel,
    memoryApiUrl: fileConfig.memoryApiUrl,
    memoryApiKey: resolveSecretValue(fileConfig.memoryApiKey),
    memoryTemperature: fileConfig.memoryTemperature,
    memoryExtraParams: fileConfig.memoryExtraParams,
    opencodeProvider: fileConfig.opencodeProvider,
    opencodeModel: fileConfig.opencodeModel,
    aiSessionRetentionDays: fileConfig.aiSessionRetentionDays ?? DEFAULTS.aiSessionRetentionDays,
    webServerEnabled: fileConfig.webServerEnabled ?? DEFAULTS.webServerEnabled,
    webServerPort: fileConfig.webServerPort ?? DEFAULTS.webServerPort,
    webServerHost: fileConfig.webServerHost ?? DEFAULTS.webServerHost,
    webServerAllowedOrigin: fileConfig.webServerAllowedOrigin ?? DEFAULTS.webServerAllowedOrigin,
    userProfileAnalysisInterval:
      fileConfig.userProfileAnalysisInterval ?? DEFAULTS.userProfileAnalysisInterval,
    userProfileMaxPreferences:
      fileConfig.userProfileMaxPreferences ?? DEFAULTS.userProfileMaxPreferences,
    userProfileMaxPatterns: fileConfig.userProfileMaxPatterns ?? DEFAULTS.userProfileMaxPatterns,
    userProfileMaxWorkflows: fileConfig.userProfileMaxWorkflows ?? DEFAULTS.userProfileMaxWorkflows,
    userProfileConfidenceDecayDays:
      fileConfig.userProfileConfidenceDecayDays ?? DEFAULTS.userProfileConfidenceDecayDays,
    userProfileChangelogRetentionCount:
      fileConfig.userProfileChangelogRetentionCount ?? DEFAULTS.userProfileChangelogRetentionCount,
    showAutoCaptureToasts: fileConfig.showAutoCaptureToasts ?? DEFAULTS.showAutoCaptureToasts,
    showUserProfileToasts: fileConfig.showUserProfileToasts ?? DEFAULTS.showUserProfileToasts,
    showErrorToasts: fileConfig.showErrorToasts ?? DEFAULTS.showErrorToasts,
    postgres: {
      url: resolveSecretValue(fileConfig.postgres?.url),
      ssl: fileConfig.postgres?.ssl ?? DEFAULTS.postgres.ssl,
      maxConnections: fileConfig.postgres?.maxConnections ?? DEFAULTS.postgres.maxConnections,
      idleTimeoutSeconds:
        fileConfig.postgres?.idleTimeoutSeconds ?? DEFAULTS.postgres.idleTimeoutSeconds,
      connectTimeoutSeconds:
        fileConfig.postgres?.connectTimeoutSeconds ?? DEFAULTS.postgres.connectTimeoutSeconds,
      vectorType: fileConfig.postgres?.vectorType ?? DEFAULTS.postgres.vectorType,
      hnswEfSearch: fileConfig.postgres?.hnswEfSearch ?? DEFAULTS.postgres.hnswEfSearch,
      hnswEfConstruction:
        fileConfig.postgres?.hnswEfConstruction ?? DEFAULTS.postgres.hnswEfConstruction,
    },
    embeddingMaxTokens: {
      content: fileConfig.embeddingMaxTokens?.content ?? DEFAULTS.embeddingMaxTokens.content,
      tags: fileConfig.embeddingMaxTokens?.tags ?? DEFAULTS.embeddingMaxTokens.tags,
      query: fileConfig.embeddingMaxTokens?.query ?? DEFAULTS.embeddingMaxTokens.query,
      migration: fileConfig.embeddingMaxTokens?.migration ?? DEFAULTS.embeddingMaxTokens.migration,
    },
    embeddingTruncationSide: {
      content:
        fileConfig.embeddingTruncationSide?.content ?? DEFAULTS.embeddingTruncationSide.content,
      tags: fileConfig.embeddingTruncationSide?.tags ?? DEFAULTS.embeddingTruncationSide.tags,
      query: fileConfig.embeddingTruncationSide?.query ?? DEFAULTS.embeddingTruncationSide.query,
      migration:
        fileConfig.embeddingTruncationSide?.migration ?? DEFAULTS.embeddingTruncationSide.migration,
    },
    memory: {
      defaultScope: fileConfig.memory?.defaultScope ?? DEFAULTS.memory.defaultScope,
    },
    compaction: {
      enabled: fileConfig.compaction?.enabled ?? DEFAULTS.compaction.enabled,
      memoryLimit: fileConfig.compaction?.memoryLimit ?? DEFAULTS.compaction.memoryLimit,
    },
    chatMessage: {
      enabled: fileConfig.chatMessage?.enabled ?? DEFAULTS.chatMessage.enabled,
      maxMemories: fileConfig.chatMessage?.maxMemories ?? DEFAULTS.chatMessage.maxMemories,
      excludeCurrentSession:
        fileConfig.chatMessage?.excludeCurrentSession ?? DEFAULTS.chatMessage.excludeCurrentSession,
      maxAgeDays: fileConfig.chatMessage?.maxAgeDays,
      injectOn: (fileConfig.chatMessage?.injectOn ?? DEFAULTS.chatMessage.injectOn) as
        | "first"
        | "always",
    },
  };
}

let _globalFileConfig = loadConfigFromPaths(CONFIG_FILES);
export let CONFIG = buildConfig(_globalFileConfig);

// ── Client-only config (for thin remote plugin) ───────────────

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

export let CLIENT_CONFIG = buildClientConfig({});

export function initClientConfig(directory: string): void {
  const projectPaths = [
    join(directory, ".opencode", "opencode-mem.jsonc"),
    join(directory, ".opencode", "opencode-mem.json"),
  ];
  const globalConfig = loadConfigFromPaths(CONFIG_FILES) as Partial<ClientConfig>;
  const projectConfig = loadConfigFromPaths(projectPaths) as Partial<ClientConfig>;
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

function validateConfig(): string[] {
  const errors: string[] = [];

  if (!CONFIG.postgres.url) {
    errors.push(
      "postgres.url is required. " +
        "Set the 'postgres.url' field in config (supports env:// or file:// secret references)."
    );
  }

  if (!CONFIG.embeddingApiUrl) {
    errors.push(
      "embeddingApiUrl is required. " +
        "Set the 'embeddingApiUrl' field in config to your embedding API endpoint."
    );
  }

  if (!CONFIG.embeddingModel) {
    errors.push(
      "embeddingModel is required. " +
        "Set the 'embeddingModel' field in config to your embedding model name."
    );
  }

  if (!CONFIG.embeddingApiKey) {
    errors.push("embeddingApiKey is required. Set it in config or via OPENAI_API_KEY env var.");
  }

  return errors;
}

// Track if we can operate — checked by isConfigured()
let _configErrors: string[] = validateConfig();

export function initConfig(directory: string): void {
  const projectPaths = [
    join(directory, ".opencode", "opencode-mem.jsonc"),
    join(directory, ".opencode", "opencode-mem.json"),
  ];
  const globalConfig = loadConfigFromPaths(CONFIG_FILES);
  const projectConfig = loadConfigFromPaths(projectPaths);
  const NESTED_KEYS = [
    "postgres",
    "embeddingMaxTokens",
    "embeddingTruncationSide",
    "memory",
    "compaction",
    "chatMessage",
  ] as const;

  const merged: OpenCodeMemConfig = { ...globalConfig, ...projectConfig };
  for (const key of NESTED_KEYS) {
    const g = globalConfig[key];
    const p = projectConfig[key];
    if (g && p) {
      (merged as Record<string, unknown>)[key] = { ...g, ...p };
    }
  }
  CONFIG = buildConfig(merged);
  _configErrors = validateConfig();
}

export function isConfigured(): boolean {
  return _configErrors.length === 0;
}

export function getConfigErrors(): string[] {
  return [..._configErrors];
}
