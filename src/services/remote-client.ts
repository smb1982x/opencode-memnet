// src/services/remote-client.ts
import { CLIENT_CONFIG } from "../config.js";
import { log } from "./logger.js";

const DEFAULT_TIMEOUT = 30_000;

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class RemoteMemoryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(baseUrl: string, apiKey: string, timeout?: number) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>
  ): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const json = (await response.json()) as ApiResponse<T>;

      if (!response.ok) {
        return {
          success: false,
          error: json.error || `HTTP ${response.status}`,
        };
      }

      return json;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("RemoteMemoryClient: request failed", { method, path, error: message });
      return { success: false, error: message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── Context Injection ──────────────────────────────────

  async getContext(params: {
    sessionID?: string;
    projectTag: string;
    userId?: string;
    maxMemories?: number;
    excludeCurrentSession?: boolean;
    maxAgeDays?: number | null;
  }): Promise<ApiResponse<{ context: string; memories: any[]; profileInjected: boolean }>> {
    return this.request("POST", "/api/context/inject", params);
  }

  // ─── Auto-Capture ───────────────────────────────────────

  async autoCapture(params: {
    sessionID: string;
    projectTag: string;
    projectMetadata: Record<string, unknown>;
    conversationMessages: any[];
    userPrompt: string;
    promptMessageId: string;
  }): Promise<ApiResponse<{ captured: boolean; memoryId?: string }>> {
    return this.request("POST", "/api/auto-capture", params);
  }

  // ─── Memory Search ──────────────────────────────────────

  async searchMemories(
    query: string,
    containerTag: string,
    scope: string = "project"
  ): Promise<{
    success: boolean;
    error?: string;
    results: any[];
    total: number;
    timing: number;
  }> {
    const res = await this.request("GET", "/api/search", undefined, {
      q: query,
      tag: containerTag,
      pageSize: "20",
    });
    if (!res.success) return { success: false, error: res.error, results: [], total: 0, timing: 0 };
    const items = (res.data as any)?.items ?? [];
    const memItems = items
      .filter((i: any) => i.type === "memory")
      .map((i: any) => ({
        id: i.id,
        memory: i.content,
        similarity: i.similarity ?? 0,
        tags: i.tags,
        metadata: i.metadata,
      }));
    return { success: true, results: memItems, total: memItems.length, timing: 0 };
  }

  // ─── Memory CRUD ────────────────────────────────────────

  async addMemory(
    content: string,
    containerTag: string,
    metadata?: Record<string, unknown>
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request("POST", "/api/memories", {
      content,
      containerTag,
      type: metadata?.type,
      tags: metadata?.tags,
      displayName: metadata?.displayName,
      userName: metadata?.userName,
      userEmail: metadata?.userEmail,
      projectPath: metadata?.projectPath,
      projectName: metadata?.projectName,
      gitRepoUrl: metadata?.gitRepoUrl,
    });
  }

  async deleteMemory(memoryId: string): Promise<ApiResponse<void>> {
    return this.request("DELETE", `/api/memories/${memoryId}`);
  }

  async listMemories(
    containerTag: string,
    limit: number = 20,
    scope: string = "project"
  ): Promise<{ success: boolean; error?: string; memories: any[]; pagination: any }> {
    const res = await this.request("GET", "/api/memories", undefined, {
      tag: containerTag,
      pageSize: String(limit),
    });
    if (!res.success) return { success: false, error: res.error, memories: [], pagination: {} };
    const items = (res.data as any)?.items ?? [];
    const memories = items
      .filter((i: any) => i.type === "memory")
      .map((i: any) => ({
        id: i.id,
        summary: i.content,
        createdAt: i.createdAt,
        metadata: i.metadata,
        displayName: i.displayName,
        userName: i.userName,
        userEmail: i.userEmail,
        projectPath: i.projectPath,
        projectName: i.projectName,
        gitRepoUrl: i.gitRepoUrl,
      }));
    const data = res.data as any;
    return {
      success: true,
      memories,
      pagination: {
        currentPage: data?.page ?? 1,
        totalItems: data?.total ?? memories.length,
        totalPages: data?.totalPages ?? 1,
      },
    };
  }

  async searchMemoriesBySessionID(
    sessionID: string,
    containerTag: string,
    limit: number = 10
  ): Promise<{ success: boolean; error?: string; results: any[]; total: number; timing: number }> {
    const res = await this.request("GET", "/api/search", undefined, {
      q: sessionID,
      tag: containerTag,
      pageSize: String(limit),
    });
    if (!res.success) return { success: false, error: res.error, results: [], total: 0, timing: 0 };
    const items = (res.data as any)?.items ?? [];
    const results = items
      .filter((i: any) => i.type === "memory")
      .map((i: any) => ({
        id: i.id,
        memory: i.content,
        similarity: i.similarity ?? 0,
        tags: i.tags,
        metadata: i.metadata,
        displayName: i.displayName,
        userName: i.userName,
        userEmail: i.userEmail,
        projectPath: i.projectPath,
        projectName: i.projectName,
        gitRepoUrl: i.gitRepoUrl,
        createdAt: i.createdAt,
      }));
    return { success: true, results, total: results.length, timing: 0 };
  }

  // ─── User Profile ───────────────────────────────────────

  async getUserProfile(userId?: string): Promise<ApiResponse<any>> {
    const query: Record<string, string> = {};
    if (userId) query.userId = userId;
    return this.request("GET", "/api/user-profile", undefined, query);
  }
}

// Module-level singleton
let _client: RemoteMemoryClient | null = null;

export function getRemoteClient(): RemoteMemoryClient {
  if (_client) return _client;
  _client = new RemoteMemoryClient(CLIENT_CONFIG.serverUrl, CLIENT_CONFIG.apiKey);
  return _client;
}

export const remoteMemoryClient = getRemoteClient();
