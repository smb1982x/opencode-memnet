import { embeddingService } from "./embedding.js";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import type { MemoryType } from "../types/index.js";
import type { MemoryRepository } from "./storage/types.js";
import { createMemoryRepository } from "./storage/factory.js";

export type MemoryScope = "project" | "all-projects";

function safeToISOString(timestamp: any): string {
  try {
    if (timestamp === null || timestamp === undefined) {
      return new Date().toISOString();
    }
    const numValue = typeof timestamp === "bigint" ? Number(timestamp) : Number(timestamp);

    if (isNaN(numValue) || numValue < 0) {
      return new Date().toISOString();
    }

    return new Date(numValue).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function safeJSONParse(jsonString: any): any {
  if (!jsonString || typeof jsonString !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(jsonString);
  } catch {
    return undefined;
  }
}

function extractScopeFromContainerTag(containerTag: string): {
  scope: "user" | "project";
  hash: string;
} {
  const parts = containerTag.split("_");
  if (parts.length >= 3) {
    const scope = parts[1] as "user" | "project";
    const hash = parts.slice(2).join("_");
    return { scope, hash };
  }
  return { scope: "user", hash: containerTag };
}

function resolveScopeValue(
  scope: MemoryScope,
  containerTag: string
): { scope: "user" | "project"; hash: string } {
  if (scope === "all-projects") {
    return { scope: "project", hash: "" };
  }
  return extractScopeFromContainerTag(containerTag);
}

export class LocalMemoryClient {
  private initPromise: Promise<void> | null = null;
  private isInitialized: boolean = false;
  private readonly memoryRepo: MemoryRepository;

  constructor(memoryRepo?: MemoryRepository) {
    this.memoryRepo = memoryRepo ?? createMemoryRepository();
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await this.memoryRepo.initialize();
        this.isInitialized = true;
      } catch (error) {
        this.initPromise = null;
        log("Storage initialization failed", { error: String(error) });
        throw error;
      }
    })();

    return this.initPromise;
  }

  async warmup(progressCallback?: (progress: any) => void): Promise<void> {
    await this.initialize();
    await embeddingService.warmup(progressCallback);
  }

  async isReady(): Promise<boolean> {
    return this.isInitialized && embeddingService.isWarmedUp;
  }

  getStatus(): {
    dbConnected: boolean;
    modelLoaded: boolean;
    ready: boolean;
  } {
    return {
      dbConnected: this.isInitialized,
      modelLoaded: embeddingService.isWarmedUp,
      ready: this.isInitialized && embeddingService.isWarmedUp,
    };
  }

  async close(): Promise<void> {
    await this.memoryRepo.close();
    this.isInitialized = false;
    this.initPromise = null;
  }

  async searchMemories(query: string, containerTag: string, scope: MemoryScope = "project") {
    try {
      await this.initialize();

      const queryVector = await embeddingService.embedWithTimeout(query, { kind: "query" });
      const resolved = resolveScopeValue(scope, containerTag);

      const results = await this.memoryRepo.search({
        queryVector,
        queryText: query,
        scope: resolved.scope,
        scopeHash: resolved.hash,
        containerTag,
        includeAllContainers: scope === "all-projects",
        limit: CONFIG.maxMemories,
        similarityThreshold: CONFIG.similarityThreshold,
      });

      return { success: true as const, results, total: results.length, timing: 0 };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("searchMemories: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, results: [], total: 0, timing: 0 };
    }
  }

  async addMemory(
    content: string,
    containerTag: string,
    metadata?: {
      type?: MemoryType;
      source?: "manual" | "auto-capture" | "import" | "api";
      tags?: string[];
      tool?: string;
      sessionID?: string;
      reasoning?: string;
      captureTimestamp?: number;
      displayName?: string;
      userName?: string;
      userEmail?: string;
      projectPath?: string;
      projectName?: string;
      gitRepoUrl?: string;
      [key: string]: unknown;
    }
  ) {
    try {
      await this.initialize();

      const tags = metadata?.tags || [];
      const vector = await embeddingService.embedWithTimeout(content, { kind: "content" });
      let tagsVector: Float32Array | undefined = undefined;

      if (tags.length > 0) {
        tagsVector = await embeddingService.embedWithTimeout(tags.join(", "), { kind: "tags" });
      }

      const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const now = Date.now();

      const {
        displayName,
        userName,
        userEmail,
        projectPath,
        projectName,
        gitRepoUrl,
        type,
        tags: _tags,
        ...dynamicMetadata
      } = metadata || {};

      await this.memoryRepo.insert({
        id,
        content,
        vector,
        tagsVector,
        containerTag,
        tags: tags.length > 0 ? tags.join(",") : undefined,
        type,
        createdAt: now,
        updatedAt: now,
        displayName,
        userName,
        userEmail,
        projectPath,
        projectName,
        gitRepoUrl,
        metadata:
          Object.keys(dynamicMetadata).length > 0 ? JSON.stringify(dynamicMetadata) : undefined,
      });

      return { success: true as const, id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("addMemory: error", { error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  async deleteMemory(memoryId: string) {
    try {
      await this.initialize();

      const deleted = await this.memoryRepo.delete(memoryId);

      if (deleted) {
        return { success: true };
      }

      return { success: false, error: "Memory not found" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("deleteMemory: error", { memoryId, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async listMemories(containerTag: string, limit = 20, scope: MemoryScope = "project") {
    try {
      await this.initialize();

      const resolved = resolveScopeValue(scope, containerTag);

      const rows = await this.memoryRepo.list({
        scope: resolved.scope,
        scopeHash: resolved.hash,
        containerTag,
        includeAllContainers: scope === "all-projects",
        limit,
      });

      const memories = rows.map((r) => ({
        id: r.id,
        summary: r.content,
        createdAt: safeToISOString(r.createdAt),
        metadata: r.metadata,
        displayName: r.displayName,
        userName: r.userName,
        userEmail: r.userEmail,
        projectPath: r.projectPath,
        projectName: r.projectName,
        gitRepoUrl: r.gitRepoUrl,
      }));

      return {
        success: true as const,
        memories,
        pagination: { currentPage: 1, totalItems: memories.length, totalPages: 1 },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("listMemories: error", { error: errorMessage });
      return {
        success: false as const,
        error: errorMessage,
        memories: [],
        pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
      };
    }
  }

  async searchMemoriesBySessionID(sessionID: string, containerTag: string, limit: number = 10) {
    try {
      await this.initialize();

      const { scope, hash } = extractScopeFromContainerTag(containerTag);

      const results = await this.memoryRepo.getBySessionId({
        sessionId: sessionID,
        scope,
        scopeHash: hash,
        limit,
      });

      const mapped = results.map((row) => ({
        id: row.id,
        memory: row.memory,
        similarity: row.similarity,
        tags: row.tags,
        metadata: row.metadata,
        containerTag: row.containerTag,
        displayName: row.displayName,
        userName: row.userName,
        userEmail: row.userEmail,
        projectPath: row.projectPath,
        projectName: row.projectName,
        gitRepoUrl: row.gitRepoUrl,
        createdAt: row.createdAt,
      }));

      return { success: true as const, results: mapped, total: mapped.length, timing: 0 };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("searchMemoriesBySessionID: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, results: [], total: 0, timing: 0 };
    }
  }
}

export const memoryClient = new LocalMemoryClient();
