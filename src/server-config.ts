// src/server-config.ts
import { resolveSecretValue } from "./services/secret-resolver.js";

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

export interface ServerConfig {
  port: number;
  host: string;
  serverApiKey: string;
  postgres: {
    url: string;
    ssl: boolean | "require";
    maxConnections: number;
    idleTimeoutSeconds: number;
    connectTimeoutSeconds: number;
    vectorType: "vector" | "halfvec";
    hnswEfSearch: number;
    hnswEfConstruction: number;
  };
  embeddingModel: string;
  embeddingApiUrl: string;
  embeddingApiKey: string;
  embeddingDimensions: number;
  embeddingMaxTokens: { content: number; tags: number; query: number; migration: number };
  embeddingTruncationSide: {
    content: "left" | "right";
    tags: "left" | "right";
    query: "left" | "right";
    migration: "left" | "right";
  };
  similarityThreshold: number;
  maxMemories: number;
  injectProfile: boolean;
  memoryProvider: "openai-chat";
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  autoCaptureMaxIterations: number;
  autoCaptureIterationTimeout: number;
  autoCaptureLanguage: string;
  aiSessionRetentionDays: number;
  userProfileAnalysisInterval: number;
  userProfileMaxPreferences: number;
  userProfileMaxPatterns: number;
  userProfileMaxWorkflows: number;
  userProfileConfidenceDecayDays: number;
  userProfileChangelogRetentionCount: number;
  autoCleanupRetentionDays: number;
  webServerAllowedOrigin: string;
  disableWebuiAuth: boolean;
  disableClientAuth: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  clientWelcomeBackThreshold: number;
}

function getEmbeddingDimensions(model: string): number {
  const dimensionMap: Record<string, number> = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
    "embed-english-v3.0": 1024,
    "embed-multilingual-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-light-v3.0": 384,
    "text-embedding-004": 768,
    "text-multilingual-embedding-002": 768,
    "voyage-3": 1024,
    "voyage-3-lite": 512,
    "voyage-code-3": 1024,
  };
  return dimensionMap[model] || 1024;
}

let _config: ServerConfig | null = null;

export function initServerConfig(): ServerConfig {
  if (_config) return _config;
  const env = process.env;
  _config = {
    port: parseInt(env.SERVER_PORT || "4747"),
    host: env.SERVER_HOST || "0.0.0.0",
    serverApiKey: env.SERVER_API_KEY || "",
    postgres: {
      url: resolveSecretValue(env.POSTGRES_URL) || "",
      ssl: env.POSTGRES_SSL === "false" ? false : (env.POSTGRES_SSL as "require") || "require",
      maxConnections: parseInt(env.POSTGRES_MAX_CONNECTIONS || "10"),
      idleTimeoutSeconds: parseInt(env.POSTGRES_IDLE_TIMEOUT_SECONDS || "30"),
      connectTimeoutSeconds: parseInt(env.POSTGRES_CONNECT_TIMEOUT_SECONDS || "10"),
      vectorType: (env.POSTGRES_VECTOR_TYPE as "vector" | "halfvec") || "vector",
      hnswEfSearch: parseInt(env.POSTGRES_HNSW_EF_SEARCH || "128"),
      hnswEfConstruction: parseInt(env.POSTGRES_HNSW_EF_CONSTRUCTION || "256"),
    },
    embeddingModel: env.EMBEDDING_MODEL || "",
    embeddingApiUrl: env.EMBEDDING_API_URL || "",
    embeddingApiKey: resolveSecretValue(env.EMBEDDING_API_KEY || "") || env.OPENAI_API_KEY || "",
    embeddingDimensions:
      parseInt(env.EMBEDDING_DIMENSIONS || "0") ||
      getEmbeddingDimensions(env.EMBEDDING_MODEL || ""),
    embeddingMaxTokens: {
      content: parseInt(env.EMBEDDING_MAX_TOKENS_CONTENT || "2048"),
      tags: parseInt(env.EMBEDDING_MAX_TOKENS_TAGS || "256"),
      query: parseInt(env.EMBEDDING_MAX_TOKENS_QUERY || "512"),
      migration: parseInt(env.EMBEDDING_MAX_TOKENS_MIGRATION || "2048"),
    },
    embeddingTruncationSide: {
      content: (env.EMBEDDING_TRUNCATION_CONTENT as "left" | "right") || "right",
      tags: (env.EMBEDDING_TRUNCATION_TAGS as "left" | "right") || "right",
      query: (env.EMBEDDING_TRUNCATION_QUERY as "left" | "right") || "right",
      migration: (env.EMBEDDING_TRUNCATION_MIGRATION as "left" | "right") || "right",
    },
    similarityThreshold: parseFloat(env.SIMILARITY_THRESHOLD || "0.6"),
    maxMemories: parseInt(env.MAX_MEMORIES || "10"),
    injectProfile: env.INJECT_PROFILE !== "false",
    memoryProvider: "openai-chat",
    memoryModel: env.MEMORY_MODEL || undefined,
    memoryApiUrl: env.MEMORY_API_URL || undefined,
    memoryApiKey: resolveSecretValue(env.MEMORY_API_KEY || "") || undefined,
    memoryTemperature:
      env.MEMORY_TEMPERATURE === "false"
        ? false
        : env.MEMORY_TEMPERATURE
          ? parseFloat(env.MEMORY_TEMPERATURE)
          : 0.3,
    opencodeProvider: env.OPENCODE_PROVIDER || undefined,
    opencodeModel: env.OPENCODE_MODEL || undefined,
    autoCaptureMaxIterations: parseInt(env.AUTO_CAPTURE_MAX_ITERATIONS || "5"),
    autoCaptureIterationTimeout: parseInt(env.AUTO_CAPTURE_ITERATION_TIMEOUT || "30000"),
    autoCaptureLanguage: env.AUTO_CAPTURE_LANGUAGE || "auto",
    aiSessionRetentionDays: parseInt(env.AI_SESSION_RETENTION_DAYS || "7"),
    userProfileAnalysisInterval: parseInt(env.USER_PROFILE_ANALYSIS_INTERVAL || "10"),
    userProfileMaxPreferences: parseInt(env.USER_PROFILE_MAX_PREFERENCES || "20"),
    userProfileMaxPatterns: parseInt(env.USER_PROFILE_MAX_PATTERNS || "15"),
    userProfileMaxWorkflows: parseInt(env.USER_PROFILE_MAX_WORKFLOWS || "10"),
    userProfileConfidenceDecayDays: parseInt(env.USER_PROFILE_CONFIDENCE_DECAY_DAYS || "30"),
    userProfileChangelogRetentionCount: parseInt(env.USER_PROFILE_CHANGELOG_RETENTION || "5"),
    autoCleanupRetentionDays: parseInt(env.AUTO_CLEANUP_RETENTION_DAYS || "90"),
    webServerAllowedOrigin: env.WEB_SERVER_ALLOWED_ORIGIN || "*",
    disableWebuiAuth: env.DISABLE_WEBUI_AUTH === "true",
    disableClientAuth: env.DISABLE_CLIENT_AUTH === "true",
    logLevel:
      (env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ||
      (env.DEBUG === "true" || env.DEBUG === "1" ? "debug" : "info"),
    clientWelcomeBackThreshold: parseDurationString(env.CLIENT_WELCOME_BACK_THRESHOLD || "7d"),
  };
  return _config;
}

export function getServerConfig(): ServerConfig {
  if (!_config) throw new Error("Server config not initialized. Call initServerConfig() first.");
  return _config;
}

export function validateServerConfig(config: ServerConfig): string[] {
  const errors: string[] = [];
  if (!config.postgres.url) errors.push("POSTGRES_URL is required");
  if (!config.embeddingApiUrl) errors.push("EMBEDDING_API_URL is required");
  if (!config.embeddingModel) errors.push("EMBEDDING_MODEL is required");
  if (!config.embeddingApiKey) errors.push("EMBEDDING_API_KEY is required (or OPENAI_API_KEY)");
  if (!config.serverApiKey) {
    if (!config.disableWebuiAuth || !config.disableClientAuth) {
      errors.push(
        "SERVER_API_KEY is required (unless both DISABLE_WEBUI_AUTH and DISABLE_CLIENT_AUTH are true)"
      );
    }
  }
  return errors;
}
