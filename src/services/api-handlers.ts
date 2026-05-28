import { embeddingService } from "./embedding.js";
import { log, logInfo, logDebug, logError } from "./logger.js";
import { getServerConfig } from "../server-config.js";
import { CONFIG } from "../config.js";
import type { MemoryType } from "../types/index.js";
import {
  createMemoryRepository,
  createUserPromptRepository,
  createUserProfileRepository,
  createClientRepository,
} from "./storage/factory.js";
import type {
  MemoryRepository,
  UserPromptRepository,
  UserProfileRepository,
  UserProfileData,
  MemoryRow,
  MemoryRecord,
  MemoryScopeKind,
  ClientRepository,
} from "./storage/types.js";

const memoryRepo: MemoryRepository = createMemoryRepository();
const promptRepo: UserPromptRepository = createUserPromptRepository();
const profileRepo: UserProfileRepository = createUserProfileRepository();
let clientRepo: ClientRepository | null = null;

// Repositories are singletons from the factory, but initialize() (which runs
// DB migrations) must be called before first use.  The LocalMemoryClient does
// this for the memory repo, but the API handlers are invoked independently
// (e.g. by the web-server) so we guard every handler entry-point.
let _initPromise: Promise<void> | null = null;
async function ensureInit(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      await memoryRepo.initialize();
      await promptRepo.initialize();
      await profileRepo.initialize();
      clientRepo = createClientRepository();
      await clientRepo.initialize();
    })().catch((err) => {
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Memory {
  id: string;
  content: string;
  type?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
}

interface TagInfo {
  tag: string;
  tags?: string[];
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

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

function extractScopeFromTag(tag: string): { scope: "project"; hash: string } {
  const parts = tag.split("_");
  if (parts.length >= 3) {
    const hash = parts.slice(2).join("_");
    return { scope: "project", hash };
  }
  return { scope: "project", hash: tag };
}

async function getProjectPathFromTag(tag: string): Promise<string | undefined> {
  const tags = await memoryRepo.getDistinctTags({ scope: "project" });
  const match = tags.find((t) => t.tag === tag);
  return match?.projectPath;
}

function metadataScore(t: TagInfo): number {
  return (
    (t.displayName ? 1 : 0) +
    (t.userName ? 1 : 0) +
    (t.userEmail ? 1 : 0) +
    (t.projectPath ? 1 : 0) +
    (t.projectName ? 1 : 0) +
    (t.gitRepoUrl ? 1 : 0)
  );
}

export async function handleListTags(): Promise<ApiResponse<{ project: TagInfo[] }>> {
  try {
    await ensureInit();
    // Tags are stored as SQLite metadata; embedding model is not needed.
    // Calling warmup() here would block on local transformer init in the worker
    // thread and hang every read API. Only handlers that compute similarity
    // (e.g. handleSearch) should warm up the embedding service.
    const allTags = await memoryRepo.getDistinctTags({ scope: "project" });
    const projectTags: TagInfo[] = allTags
      .filter((t) => t.tag.includes("_project_"))
      .map((t) => ({
        tag: t.tag,
        displayName: t.displayName,
        userName: t.userName,
        userEmail: t.userEmail,
        projectPath: t.projectPath,
        projectName: t.projectName,
        gitRepoUrl: t.gitRepoUrl,
      }));
    // Deduplicate by tag: DISTINCT in Postgres treats NULL as a unique value,
    // so rows with different user metadata can produce duplicate tag entries.
    // Pick the entry with the most non-null metadata fields.
    const deduped = new Map<string, TagInfo>();
    for (const t of projectTags) {
      const existing = deduped.get(t.tag);
      if (!existing || metadataScore(t) > metadataScore(existing)) {
        deduped.set(t.tag, t);
      }
    }
    return { success: true, data: { project: Array.from(deduped.values()) } };
  } catch (error) {
    log("handleListTags: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleListMemories(
  tag?: string,
  page: number = 1,
  pageSize: number = 20,
  includePrompts: boolean = true,
  userEmail?: string
): Promise<ApiResponse<PaginatedResponse<Memory | any>>> {
  try {
    await ensureInit();
    // Listing only reads SQLite rows; no vector ops happen here.
    // See handleListTags comment - keep embedding init out of read paths.
    let memoryRows: MemoryRow[];
    if (tag) {
      const { scope: tagScope, hash } = extractScopeFromTag(tag);
      memoryRows = await memoryRepo.list({
        scope: tagScope as MemoryScopeKind,
        scopeHash: hash,
        containerTag: tag,
        limit: 10000,
        userEmail,
      });
    } else {
      // #10: Cap at 1000 rows when no tag filter to prevent unbounded load / OOM.
      memoryRows = await memoryRepo.list({
        scope: "project",
        scopeHash: "",
        containerTag: "",
        includeAllContainers: true,
        limit: 1000,
        userEmail,
      });
      memoryRows = memoryRows.filter((m) => m.containerTag.includes("_project_"));
    }

    const memoriesWithType = memoryRows.map((r) => ({
      type: "memory" as const,
      id: r.id,
      content: r.content,
      containerTag: r.containerTag,
      memoryType: r.type,
      tags: r.tags,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      metadata: r.metadata,
      linkedPromptId: r.metadata?.promptId,
      displayName: r.displayName,
      userName: r.userName,
      userEmail: r.userEmail,
      projectPath: r.projectPath,
      projectName: r.projectName,
      gitRepoUrl: r.gitRepoUrl,
      isPinned: r.isPinned,
    }));

    let timeline: any[] = memoriesWithType;
    if (includePrompts) {
      const projectPath = tag ? await getProjectPathFromTag(tag) : undefined;
      const prompts = await promptRepo.getCapturedPrompts(projectPath ?? undefined);
      const promptsWithType = prompts.map((p) => ({
        type: "prompt" as const,
        id: p.id,
        sessionId: p.sessionId,
        content: p.content,
        createdAt: p.createdAt,
        projectPath: p.projectPath,
        linkedMemoryId: p.linkedMemoryId,
      }));
      timeline = [...memoriesWithType, ...promptsWithType];
    }

    const linkedPairs = new Map<string, { memory: any; prompt: any }>();
    const standalone: any[] = [];
    for (const item of timeline) {
      if (item.type === "memory" && item.linkedPromptId) {
        if (!linkedPairs.has(item.linkedPromptId)) {
          linkedPairs.set(item.linkedPromptId, { memory: item, prompt: null });
        } else {
          linkedPairs.get(item.linkedPromptId)!.memory = item;
        }
      } else if (item.type === "prompt" && item.linkedMemoryId) {
        if (!linkedPairs.has(item.id)) {
          linkedPairs.set(item.id, { memory: null, prompt: item });
        } else {
          linkedPairs.get(item.id)!.prompt = item;
        }
      } else {
        standalone.push(item);
      }
    }

    const sortedTimeline: any[] = [];
    const allPairs = Array.from(linkedPairs.values());
    const completePairs = allPairs
      .filter((p) => p.memory && p.prompt)
      .sort((a, b) => Number(b.memory.createdAt || 0) - Number(a.memory.createdAt || 0));
    for (const pair of completePairs) {
      sortedTimeline.push(pair.memory);
      sortedTimeline.push(pair.prompt);
    }
    // Add orphaned items (linked but partner deleted) back to standalone
    const incompletePairs = allPairs.filter((p) => !(p.memory && p.prompt));
    for (const pair of incompletePairs) {
      if (pair.memory) standalone.push(pair.memory);
      if (pair.prompt) standalone.push(pair.prompt);
    }
    standalone.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    sortedTimeline.push(...standalone);
    timeline = sortedTimeline;

    const total = timeline.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const paginatedResults = timeline.slice(offset, offset + pageSize);

    const items = paginatedResults.map((item: any) => {
      if (item.type === "memory") {
        return {
          type: "memory",
          id: item.id,
          content: item.content,
          containerTag: item.containerTag,
          memoryType: item.memoryType,
          tags: item.tags,
          createdAt: safeToISOString(item.createdAt),
          updatedAt: item.updatedAt ? safeToISOString(item.updatedAt) : undefined,
          metadata: item.metadata,
          linkedPromptId: item.linkedPromptId,
          displayName: item.displayName,
          userName: item.userName,
          userEmail: item.userEmail,
          projectPath: item.projectPath,
          projectName: item.projectName,
          gitRepoUrl: item.gitRepoUrl,
          isPinned: item.isPinned,
        };
      } else {
        return {
          type: "prompt",
          id: item.id,
          sessionId: item.sessionId,
          content: item.content,
          createdAt: safeToISOString(item.createdAt),
          projectPath: item.projectPath,
          linkedMemoryId: item.linkedMemoryId,
        };
      }
    });

    return { success: true, data: { items, total, page, pageSize, totalPages } };
  } catch (error) {
    log("handleListMemories: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleAddMemory(data: {
  content: string;
  containerTag: string;
  type?: MemoryType;
  tags?: string[];
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}): Promise<ApiResponse<{ id: string }>> {
  try {
    if (!data.content || !data.containerTag) {
      return { success: false, error: "content and containerTag are required" };
    }
    await ensureInit();
    await embeddingService.warmup();
    const tags = (data.tags || []).map((t) => t.trim().toLowerCase());
    const embeddingInput =
      tags.length > 0 ? `${data.content}\nTags: ${tags.join(", ")}` : data.content;

    const vector = await embeddingService.embedWithTimeout(embeddingInput, { kind: "content" });
    let tagsVector: Float32Array | undefined = undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(tags.join(", "), { kind: "tags" });
    }

    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const now = Date.now();

    const record: MemoryRecord = {
      id,
      content: data.content,
      vector,
      tagsVector,
      containerTag: data.containerTag,
      tags: tags.length > 0 ? tags.join(",") : undefined,
      type: data.type,
      createdAt: now,
      updatedAt: now,
      metadata: JSON.stringify({ source: "api" }),
      displayName: data.displayName,
      userName: data.userName,
      userEmail: data.userEmail,
      projectPath: data.projectPath,
      projectName: data.projectName,
      gitRepoUrl: data.gitRepoUrl,
    };

    await memoryRepo.insert(record);
    return { success: true, data: { id } };
  } catch (error) {
    log("handleAddMemory: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleDeleteMemory(
  id: string,
  cascade: boolean = false
): Promise<ApiResponse<{ deletedPrompt: boolean }>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    const memory = await memoryRepo.getById(id);
    if (!memory) return { success: false, error: "Memory not found" };
    let linkedPromptId: string | undefined;
    if (cascade) {
      const metadata =
        typeof memory.metadata === "string"
          ? (() => {
              try {
                return JSON.parse(memory.metadata as string);
              } catch {
                return undefined;
              }
            })()
          : memory.metadata;
      linkedPromptId = metadata?.promptId as string | undefined;
      if (linkedPromptId) await promptRepo.deletePrompt(linkedPromptId);
    }
    await memoryRepo.delete(id);
    return {
      success: true,
      data: { deletedPrompt: cascade && !!linkedPromptId },
    };
  } catch (error) {
    log("handleDeleteMemory: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleBulkDelete(
  ids: string[],
  cascade: boolean = false
): Promise<ApiResponse<{ deleted: number }>> {
  try {
    if (!ids || ids.length === 0) return { success: false, error: "ids array is required" };
    let deleted = 0;
    for (const id of ids) {
      const result = await handleDeleteMemory(id, cascade);
      if (result.success) deleted++;
    }
    return { success: true, data: { deleted } };
  } catch (error) {
    log("handleBulkDelete: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleUpdateMemory(
  id: string,
  data: { content?: string; type?: MemoryType; tags?: string[]; containerTag?: string }
): Promise<ApiResponse<void>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    await embeddingService.warmup();
    const existingMemory = await memoryRepo.getById(id);
    if (!existingMemory) return { success: false, error: "Memory not found" };

    const newContent = data.content || existingMemory.content;
    // Storage may return tags as comma-separated string despite typed as string[]
    const rawTags = existingMemory.tags as unknown;
    const existingTags: string[] =
      typeof rawTags === "string"
        ? rawTags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : Array.isArray(rawTags)
          ? rawTags
          : [];
    const tags = data.tags !== undefined ? data.tags : existingTags;

    const vector = await embeddingService.embedWithTimeout(newContent, { kind: "content" });
    let tagsVector: Float32Array | undefined = undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(tags.join(", "), { kind: "tags" });
    }

    const updatedRecord: MemoryRecord = {
      id,
      content: newContent,
      vector,
      tagsVector,
      containerTag: data.containerTag || existingMemory.containerTag,
      tags: tags.length > 0 ? tags.join(",") : undefined,
      type: data.type || existingMemory.type,
      createdAt: existingMemory.createdAt,
      updatedAt: Date.now(),
      metadata: existingMemory.metadata
        ? typeof existingMemory.metadata === "string"
          ? existingMemory.metadata
          : JSON.stringify(existingMemory.metadata)
        : undefined,
      displayName: existingMemory.displayName,
      userName: existingMemory.userName,
      userEmail: existingMemory.userEmail,
      projectPath: existingMemory.projectPath,
      projectName: existingMemory.projectName,
      gitRepoUrl: existingMemory.gitRepoUrl,
    };

    await memoryRepo.update(updatedRecord);
    return { success: true };
  } catch (error) {
    log("handleUpdateMemory: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

interface FormattedPrompt {
  type: "prompt";
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
  projectPath: string | null;
  linkedMemoryId: string | null;
  similarity?: number;
  isContext?: boolean;
}

interface FormattedMemory {
  type: "memory";
  id: string;
  content: string;
  memoryType?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
  linkedPromptId?: string;
  isContext?: boolean;
}

type SearchResultItem = FormattedPrompt | FormattedMemory;

export async function handleSearch(
  query: string,
  tag?: string,
  page: number = 1,
  pageSize: number = 20,
  userEmail?: string
): Promise<ApiResponse<PaginatedResponse<SearchResultItem>>> {
  try {
    await ensureInit();
    if (!query) return { success: false, error: "query is required" };
    await embeddingService.warmup();
    const queryVector = await embeddingService.embedWithTimeout(query, { kind: "query" });
    let memoryResults: any[] = [];
    let promptResults: any[] = [];

    if (tag) {
      const { scope, hash } = extractScopeFromTag(tag);
      const results = await memoryRepo.search({
        queryVector,
        scope: scope as MemoryScopeKind,
        scopeHash: hash,
        containerTag: tag,
        limit: pageSize * 4,
        similarityThreshold: 0,
        queryText: query,
        userEmail,
      });
      memoryResults.push(...results);

      const projectPath = await getProjectPathFromTag(tag);
      promptResults = await promptRepo.searchPrompts(query, projectPath ?? undefined, pageSize * 2);
    } else {
      // Search across all project shards without container-tag filter
      const results = await memoryRepo.search({
        queryVector,
        scope: "project",
        scopeHash: "",
        containerTag: "",
        includeAllContainers: true,
        limit: pageSize * 10,
        similarityThreshold: 0,
        queryText: query,
        userEmail,
      });
      memoryResults.push(...results);
      promptResults = await promptRepo.searchPrompts(query, undefined, pageSize * 2);
    }

    const formattedPrompts: FormattedPrompt[] = promptResults.map((p) => ({
      type: "prompt",
      id: p.id,
      sessionId: p.sessionId,
      content: p.content,
      createdAt: safeToISOString(p.createdAt),
      projectPath: p.projectPath,
      linkedMemoryId: p.linkedMemoryId,
      similarity: undefined,
    }));

    const formattedMemories: FormattedMemory[] = memoryResults.map((r: any) => ({
      type: "memory",
      id: r.id,
      content: r.memory,
      memoryType: r.metadata?.type,
      tags: r.tags,
      createdAt: safeToISOString(r.createdAt),
      updatedAt: r.metadata?.updatedAt ? safeToISOString(r.metadata.updatedAt) : undefined,
      similarity: r.similarity,
      metadata: r.metadata,
      displayName: r.displayName,
      userName: r.userName,
      userEmail: r.userEmail,
      projectPath: r.projectPath,
      projectName: r.projectName,
      gitRepoUrl: r.gitRepoUrl,
      isPinned: r.isPinned === 1 || r.isPinned === true,
      linkedPromptId: r.metadata?.promptId,
    }));

    const combinedResults = [...formattedMemories, ...formattedPrompts].sort(
      (a: any, b: any) =>
        (b.similarity || 0) - (a.similarity || 0) || b.createdAt.localeCompare(a.createdAt)
    );

    const offset = (page - 1) * pageSize;
    const paginatedResults: SearchResultItem[] = combinedResults.slice(offset, offset + pageSize);

    // Capture total BEFORE appending linked extras so pageSize contract is consistent
    const total = combinedResults.length;

    const missingPromptIds = new Set<string>();
    const missingMemoryIds = new Set<string>();
    for (const item of paginatedResults) {
      if (item.type === "memory" && item.linkedPromptId) {
        if (!paginatedResults.some((p) => p.id === item.linkedPromptId))
          missingPromptIds.add(item.linkedPromptId);
      } else if (item.type === "prompt" && item.linkedMemoryId) {
        if (!paginatedResults.some((m) => m.id === item.linkedMemoryId))
          missingMemoryIds.add(item.linkedMemoryId);
      }
    }

    if (missingPromptIds.size > 0) {
      const extraPrompts = await promptRepo.getPromptsByIds(Array.from(missingPromptIds));
      for (const p of extraPrompts) {
        paginatedResults.push({
          type: "prompt",
          id: p.id,
          sessionId: p.sessionId,
          content: p.content,
          createdAt: safeToISOString(p.createdAt),
          projectPath: p.projectPath,
          linkedMemoryId: p.linkedMemoryId,
          similarity: 0,
          isContext: true,
        });
      }
    }

    if (missingMemoryIds.size > 0) {
      for (const mid of missingMemoryIds) {
        const m = await memoryRepo.getById(mid);
        if (m && !paginatedResults.some((existing) => existing.id === m.id)) {
          paginatedResults.push({
            type: "memory",
            id: m.id,
            content: m.content,
            memoryType: m.type,
            tags: m.tags,
            createdAt: safeToISOString(m.createdAt),
            updatedAt: m.updatedAt ? safeToISOString(m.updatedAt) : undefined,
            similarity: 0,
            metadata: m.metadata,
            displayName: m.displayName,
            userName: m.userName,
            userEmail: m.userEmail,
            projectPath: m.projectPath,
            projectName: m.projectName,
            gitRepoUrl: m.gitRepoUrl,
            isPinned: m.isPinned,
            linkedPromptId: m.metadata?.promptId as string | undefined,
            isContext: true,
          });
        }
      }
    }

    // total was captured before appending linked extras
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { success: true, data: { items: paginatedResults, total, page, pageSize, totalPages } };
  } catch (error) {
    log("handleSearch: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleStats(): Promise<
  ApiResponse<{
    total: number;
    byScope: { user: number; project: number };
    byType: Record<string, number>;
  }>
> {
  try {
    await ensureInit();
    // Use COUNT(*) queries instead of loading all rows into memory.
    const [userCount, projectCount, typeCount] = await Promise.all([
      memoryRepo.count({ scope: "user" }),
      memoryRepo.count({ scope: "project" }),
      memoryRepo.countByType(),
    ]);
    return {
      success: true,
      data: {
        total: userCount + projectCount,
        byScope: { user: userCount, project: projectCount },
        byType: typeCount,
      },
    };
  } catch (error) {
    log("handleStats: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handlePinMemory(id: string): Promise<ApiResponse<void>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    const memory = await memoryRepo.getById(id);
    if (!memory) return { success: false, error: "Memory not found" };
    await memoryRepo.pin(id);
    return { success: true };
  } catch (error) {
    log("handlePinMemory: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleUnpinMemory(id: string): Promise<ApiResponse<void>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    const memory = await memoryRepo.getById(id);
    if (!memory) return { success: false, error: "Memory not found" };
    await memoryRepo.unpin(id);
    return { success: true };
  } catch (error) {
    log("handleUnpinMemory: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleDeletePrompt(
  id: string,
  cascade: boolean = false
): Promise<ApiResponse<{ deletedMemory: boolean }>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    const prompt = await promptRepo.getPromptById(id);
    if (!prompt) return { success: false, error: "Prompt not found" };
    let deletedMemory = false;
    if (cascade && prompt.linkedMemoryId) {
      const result = await handleDeleteMemory(prompt.linkedMemoryId, false);
      if (result.success) deletedMemory = true;
    }
    await promptRepo.deletePrompt(id);
    return { success: true, data: { deletedMemory } };
  } catch (error) {
    log("handleDeletePrompt: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleBulkDeletePrompts(
  ids: string[],
  cascade: boolean = false
): Promise<ApiResponse<{ deleted: number }>> {
  try {
    if (!ids || ids.length === 0) return { success: false, error: "ids array is required" };
    let deleted = 0;
    for (const id of ids) {
      const result = await handleDeletePrompt(id, cascade);
      if (result.success) deleted++;
    }
    return { success: true, data: { deleted } };
  } catch (error) {
    log("handleBulkDeletePrompts: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleGetUserProfile(userId?: string): Promise<ApiResponse<any>> {
  try {
    await ensureInit();
    const { getTags } = await import("./tags.js");
    let targetUserId = userId;
    if (!targetUserId) {
      const tags = await getTags(process.cwd());
      targetUserId = tags.user.userEmail || "unknown";
    }
    const profile = await profileRepo.getActiveProfile(targetUserId);
    if (!profile)
      return {
        success: true,
        data: {
          exists: false,
          userId: targetUserId,
          message: "No profile found. Keep chatting to build your profile.",
        },
      };
    const profileData = JSON.parse(profile.profileData);
    return {
      success: true,
      data: {
        exists: true,
        id: profile.id,
        userId: profile.userId,
        displayName: profile.displayName,
        userName: profile.userName,
        userEmail: profile.userEmail,
        version: profile.version,
        createdAt: safeToISOString(profile.createdAt),
        lastAnalyzedAt: safeToISOString(profile.lastAnalyzedAt),
        totalPromptsAnalyzed: profile.totalPromptsAnalyzed,
        profileData,
      },
    };
  } catch (error) {
    log("handleGetUserProfile: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleGetProfileChangelog(
  profileId: string,
  limit: number = 5
): Promise<ApiResponse<any[]>> {
  try {
    await ensureInit();
    if (!profileId) return { success: false, error: "profileId is required" };
    const changelogs = await profileRepo.getProfileChangelogs(profileId, limit);
    const formattedChangelogs = changelogs.map((c) => ({
      id: c.id,
      profileId: c.profileId,
      version: c.version,
      changeType: c.changeType,
      changeSummary: c.changeSummary,
      createdAt: safeToISOString(c.createdAt),
    }));
    return { success: true, data: formattedChangelogs };
  } catch (error) {
    log("handleGetProfileChangelog: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleGetProfileSnapshot(changelogId: string): Promise<ApiResponse<any>> {
  try {
    await ensureInit();
    if (!changelogId) return { success: false, error: "changelogId is required" };
    const changelog = await profileRepo.getChangelogById(changelogId);
    if (!changelog) return { success: false, error: "Changelog not found" };
    const profileData = JSON.parse(changelog.profileDataSnapshot);
    return {
      success: true,
      data: {
        version: changelog.version,
        createdAt: safeToISOString(changelog.createdAt),
        profileData,
      },
    };
  } catch (error) {
    log("handleGetProfileSnapshot: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleRefreshProfile(userId?: string): Promise<ApiResponse<any>> {
  try {
    await ensureInit();
    const { getTags } = await import("./tags.js");
    let targetUserId = userId;
    if (!targetUserId) {
      const tags = await getTags(process.cwd());
      targetUserId = tags.user.userEmail || "unknown";
    }
    const unanalyzedCount = await promptRepo.countUnanalyzedForUserLearning();
    return {
      success: true,
      data: {
        message: "Profile refresh queued",
        unanalyzedPrompts: unanalyzedCount,
        note: "Profile will be updated when threshold is reached",
      },
    };
  } catch (error) {
    log("handleRefreshProfile: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleDetectTagMigration(): Promise<
  ApiResponse<{ needsMigration: boolean; count: number }>
> {
  try {
    await ensureInit();

    // Restore migration completion state from persisted marker
    if (migrationProgress.total === 0) {
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const dataDir = CONFIG.storagePath || "/tmp/opencode-memnet-data";
        const marker = JSON.parse(
          await fs.readFile(path.join(dataDir, ".migration", "tag-migration.json"), "utf-8")
        );
        if (marker.completed) {
          migrationProgress = {
            processed: marker.processed ?? 0,
            total: marker.processed ?? 0,
            currentBatch: 0,
            totalBatches: 0,
            isComplete: true,
            errors: [],
          };
        }
      } catch {
        /* file doesn't exist yet — first run or fresh state */
      }
    }

    const untaggedCount = await memoryRepo.countUntagged();
    if (untaggedCount === 0) {
      // Auto-reset stale migration state when no untagged memories remain
      migrationProgress = {
        processed: 0,
        total: 0,
        currentBatch: 0,
        totalBatches: 0,
        isComplete: true,
        errors: [],
      };
      _migrationRunning = false;
      cachedMigrationRecords = null;
    }
    // Suppress nag when migration already ran and completed — AI failures
    // on remaining untagged memories won't be fixed by re-running.
    if (migrationProgress.isComplete && migrationProgress.total > 0) {
      return { success: true, data: { needsMigration: false, count: untaggedCount } };
    }

    return { success: true, data: { needsMigration: untaggedCount > 0, count: untaggedCount } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

interface MigrationProgress {
  processed: number;
  total: number;
  currentBatch: number;
  totalBatches: number;
  isComplete: boolean;
  errors: string[];
}

// NOTE: This module-level state assumes a single-user / single-process model.
// Concurrent requests from different sessions may race on the isComplete flag.
// The guard below is a best-effort check — not a hard lock — which is acceptable
// for the intended single-user usage pattern.
let migrationProgress: MigrationProgress = {
  processed: 0,
  total: 0,
  currentBatch: 0,
  totalBatches: 0,
  isComplete: true,
  errors: [],
};

// ── Migration running guard: prevents concurrent batch calls (sequential calls are expected) ──
let _migrationRunning = false;

// ── Cleanup guard (best-effort lock; same single-user/single-process model as migrationProgress) ──
let _cleanupInProgress = false;

// ── Deduplicate guard (prevents concurrent dedup operations) ──
let _dedupInProgress = false;

// Cached record list for the current migration run – avoids reloading
// every memory (including vectors) on each batch call.
let cachedMigrationRecords: MemoryRecord[] | null = null;

export async function handleGetTagMigrationProgress(): Promise<
  ApiResponse<{ status: string; processed: number; total: number; errors: string[] }>
> {
  const { getMigrationProgress } = await import("./tag-migration-service.js");
  return { success: true, data: getMigrationProgress() };
}

export async function handleRunTagMigrationBatch(
  _batchSize: number = 5
): Promise<ApiResponse<{ processed: number; total: number; hasMore: boolean }>> {
  // Delegate to the background service
  const { getMigrationProgress, runTagMigration } = await import("./tag-migration-service.js");
  const progress = getMigrationProgress();
  if (progress.status === "running") {
    return {
      success: true,
      data: { processed: progress.processed, total: progress.total, hasMore: true },
    };
  }
  // Fire and forget — the service loop handles retries
  runTagMigration().catch(() => {});
  return { success: true, data: { processed: 0, total: 0, hasMore: true } };
}

// ── New endpoints for server-client architecture ────────────

export async function handleContextInject(data: {
  sessionID?: string;
  projectTag: string;
  userId?: string;
  maxMemories?: number;
  excludeCurrentSession?: boolean;
  maxAgeDays?: number | null;
}): Promise<
  ApiResponse<{
    context: string;
    memories: Array<{ id: string; summary: string; createdAt: string; similarity: number }>;
    profileInjected: boolean;
  }>
> {
  try {
    await ensureInit();

    const maxMemories = data.maxMemories ?? CONFIG.chatMessage?.maxMemories ?? 3;
    const excludeCurrentSession = data.excludeCurrentSession ?? true;
    const maxAgeDays = data.maxAgeDays ?? null;

    const { scope, hash } = extractScopeFromTag(data.projectTag);
    const rows = await memoryRepo.list({
      scope: scope as MemoryScopeKind,
      scopeHash: hash,
      containerTag: data.projectTag,
      limit: maxMemories * 3,
    });

    // Memories are listed in recency order (newest first) for context injection.
    // Set a neutral similarity for consistent response shape.
    let memories = rows.map((r) => ({
      id: r.id,
      summary: r.content,
      createdAt: safeToISOString(r.createdAt),
      similarity: 0.5,
      _metadata: r.metadata,
    }));

    if (excludeCurrentSession && data.sessionID) {
      memories = memories.filter((m: any) => {
        try {
          const meta = typeof m._metadata === "string" ? JSON.parse(m._metadata) : m._metadata;
          return meta?.sessionID !== data.sessionID;
        } catch {
          return true;
        }
      });
    }

    if (maxAgeDays != null && maxAgeDays > 0) {
      const cutoffDate = Date.now() - maxAgeDays * 86400000;
      memories = memories.filter((m: any) => new Date(m.createdAt).getTime() > cutoffDate);
    }

    memories = memories.slice(0, maxMemories);

    const parts: string[] = ["[MEMORY]"];
    let profileInjected = false;

    if (CONFIG.injectProfile && data.userId) {
      const profile = await profileRepo.getActiveProfile(data.userId);
      if (profile) {
        try {
          const profileData = JSON.parse(profile.profileData);
          const preferences = (profileData?.preferences ?? []).sort(
            (a: any, b: any) => b.confidence - a.confidence
          );
          const patterns = (profileData?.patterns ?? []).sort(
            (a: any, b: any) => b.frequency - a.frequency
          );
          const workflows = profileData?.workflows ?? [];

          if (preferences.length > 0) {
            parts.push("\nUser Preferences:");
            preferences.slice(0, 5).forEach((pref: any) => {
              parts.push(`- [${pref.category}] ${pref.description}`);
            });
          }
          if (patterns.length > 0) {
            parts.push("\nUser Patterns:");
            patterns.slice(0, 5).forEach((pat: any) => {
              parts.push(`- [${pat.category}] ${pat.description}`);
            });
          }
          if (workflows.length > 0) {
            parts.push("\nUser Workflows:");
            workflows.slice(0, 3).forEach((wf: any) => {
              parts.push(`- ${wf.description}`);
            });
          }
          profileInjected = true;
        } catch {
          // skip corrupt profile
        }
      }
    }

    if (memories.length > 0) {
      parts.push("\nProject Knowledge:");
      memories.forEach((m) => {
        parts.push(`- ${m.summary}`);
      });
    }

    const context = parts.length > 1 ? parts.join("\n") : "";

    return {
      success: true,
      data: {
        context,
        memories: memories.map(({ _metadata, ...rest }) => rest),
        profileInjected,
      },
    };
  } catch (error) {
    log("handleContextInject: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

// Phase 3: Full implementation — was stub in Phase 2
export async function handleAutoCapture(data: {
  sessionID: string;
  projectTag: string;
  projectMetadata: {
    displayName?: string;
    userName?: string;
    userEmail?: string;
    projectPath?: string;
    projectName?: string;
    gitRepoUrl?: string;
  };
  conversationMessages: Array<{
    role: string;
    parts: Array<{ type: string; text?: string; tool?: string; state?: any }>;
  }>;
  userPrompt: string;
  promptMessageId: string;
}): Promise<ApiResponse<{ captured: boolean; memoryId?: string }>> {
  try {
    await ensureInit();
    await embeddingService.warmup();

    // Extract AI content from conversation messages
    const textResponses: string[] = [];
    const toolCalls: Array<{ name: string; input: string }> = [];

    for (const msg of data.conversationMessages) {
      if (msg.role !== "assistant") continue;
      if (!Array.isArray(msg.parts)) continue;
      for (const part of msg.parts) {
        if (part.type === "text" && part.text?.trim()) {
          textResponses.push(part.text.trim());
        }
        if (part.type === "tool") {
          const name = part.tool || "unknown";
          let input = "";
          if (part.state?.input) {
            const inputObj = part.state.input;
            if (typeof inputObj === "string") {
              input = inputObj;
            } else if (typeof inputObj === "object") {
              input = Object.entries(inputObj)
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(", ");
            }
          }
          if (input.length > 100) input = input.substring(0, 100) + "...";
          toolCalls.push({ name, input });
        }
      }
    }

    if (textResponses.length === 0 && toolCalls.length === 0) {
      return { success: true, data: { captured: false } };
    }

    // Get latest memory for context
    let latestMemory: string | null = null;
    const { scope, hash } = extractScopeFromTag(data.projectTag);
    const recentRows = await memoryRepo.list({
      scope: scope as MemoryScopeKind,
      scopeHash: hash,
      containerTag: data.projectTag,
      limit: 1,
    });
    const firstRow = recentRows[0];
    if (firstRow && firstRow.content) {
      const content = firstRow.content;
      latestMemory = content.length <= 500 ? content : content.substring(0, 500) + "...";
    }

    // Build AI context
    const sections: string[] = [];
    if (latestMemory) {
      sections.push(`## Previous Memory Context\n---\n${latestMemory}\n---\n`);
    }
    sections.push(`## User Request\n---\n${data.userPrompt}\n---\n`);
    if (textResponses.length > 0) {
      sections.push(`## AI Response\n---\n${textResponses.join("\n\n")}\n---\n`);
    }
    if (toolCalls.length > 0) {
      sections.push("## Tools Used\n---");
      for (const tool of toolCalls) {
        sections.push(`- ${tool.name}${tool.input ? `(${tool.input})` : ""}`);
      }
      sections.push("---\n");
    }
    const context = sections.join("\n");

    // Generate summary via AI
    const { generateSummary } = await import("./auto-capture-server.js");
    const summaryResult = await generateSummary(context, data.sessionID, data.userPrompt);

    if (!summaryResult || summaryResult.type === "skip") {
      return { success: true, data: { captured: false } };
    }

    // Embed and store
    const embeddingInput =
      summaryResult.tags.length > 0
        ? `${summaryResult.summary}\nTags: ${summaryResult.tags.join(", ")}`
        : summaryResult.summary;

    const vector = await embeddingService.embedWithTimeout(embeddingInput, { kind: "content" });
    let tagsVector: Float32Array | undefined;
    if (summaryResult.tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(summaryResult.tags.join(", "), {
        kind: "tags",
      });
    }

    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const now = Date.now();

    await memoryRepo.insert({
      id,
      content: summaryResult.summary,
      vector,
      tagsVector,
      containerTag: data.projectTag,
      tags: summaryResult.tags.length > 0 ? summaryResult.tags.join(",") : undefined,
      type: summaryResult.type as any,
      createdAt: now,
      updatedAt: now,
      metadata: JSON.stringify({
        source: "auto-capture",
        sessionID: data.sessionID,
        promptId: data.promptMessageId,
        captureTimestamp: now,
      }),
      displayName: data.projectMetadata.displayName,
      userName: data.projectMetadata.userName,
      userEmail: data.projectMetadata.userEmail,
      projectPath: data.projectMetadata.projectPath,
      projectName: data.projectMetadata.projectName,
      gitRepoUrl: data.projectMetadata.gitRepoUrl,
    });

    return { success: true, data: { captured: true, memoryId: id } };
  } catch (error) {
    log("handleAutoCapture: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleUserProfileLearn(data: {
  userId?: string;
  projectTag?: string;
}): Promise<ApiResponse<{ updated: boolean }>> {
  try {
    await ensureInit();

    // Resolve userId
    const { getTags } = await import("./tags.js");
    let userId = data.userId;
    if (!userId) {
      const tags = await getTags(process.cwd());
      userId = tags.user.userEmail || "unknown";
    }

    // Check if enough unanalyzed prompts exist
    const unanalyzedCount = await promptRepo.countUnanalyzedForUserLearning();
    const threshold = CONFIG.userProfileAnalysisInterval;

    if (unanalyzedCount < threshold) {
      return {
        success: true,
        data: { updated: false },
      };
    }

    // Fetch prompts for analysis
    const prompts = await promptRepo.getPromptsForUserLearning(threshold);
    if (prompts.length === 0) {
      return { success: true, data: { updated: false } };
    }

    // Fetch existing profile (if any)
    const existingProfile = await profileRepo.getActiveProfile(userId);

    // Build existing profile JSON for the AI context
    let existingProfileJson: string | null = null;
    if (existingProfile) {
      existingProfileJson = existingProfile.profileData;
    }

    // Run AI analysis via server-side learner
    const { analyzeUserProfile, generateChangeSummary } =
      await import("./user-profile-learner-server.js");

    const promptTexts = prompts.map((p) => p.content);
    const updatedProfileData = await analyzeUserProfile(promptTexts, existingProfileJson);

    if (!updatedProfileData) {
      // AI returned nothing useful — mark prompts as analyzed so they don't loop
      await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
      return { success: true, data: { updated: false } };
    }

    // Save profile
    if (existingProfile) {
      let oldProfileData: UserProfileData;
      try {
        oldProfileData = JSON.parse(existingProfile.profileData);
      } catch {
        log("Corrupt profile data, skipping learning cycle", {
          profileId: existingProfile.id,
        });
        await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
        return { success: true, data: { updated: false } };
      }

      // Merge with existing data using the repository's merge logic
      const mergedData = profileRepo.mergeProfileData(oldProfileData, updatedProfileData);
      const changeSummary = generateChangeSummary(oldProfileData, mergedData);

      await profileRepo.updateProfile(
        existingProfile.id,
        mergedData,
        prompts.length,
        changeSummary
      );
    } else {
      // Resolve user metadata from tags
      const tags = await getTags(process.cwd());
      await profileRepo.createProfile(
        userId,
        tags.user.displayName || "Unknown",
        tags.user.userName || "unknown",
        tags.user.userEmail || "unknown",
        updatedProfileData,
        prompts.length
      );
    }

    // Mark prompts as analyzed
    await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));

    return { success: true, data: { updated: true } };
  } catch (error) {
    log("handleUserProfileLearn: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

// ── Stub endpoints for planned features ─────────────────

export function handleMigrationDetect(): ApiResponse<{ needsMigration: boolean }> {
  return { success: true, data: { needsMigration: false } };
}

export async function handleCleanup(): Promise<
  ApiResponse<{
    deletedMemories: number;
    deletedMemoriesUser: number;
    deletedMemoriesProject: number;
    deletedPrompts: number;
  }>
> {
  if (_cleanupInProgress) {
    return { success: false, error: "Cleanup is already in progress" };
  }

  _cleanupInProgress = true;
  try {
    await ensureInit();

    const retentionDays = CONFIG.autoCleanupRetentionDays ?? 90;
    const cutoff = Date.now() - retentionDays * 86_400_000;

    // Step 1: Delete old prompts & collect linked memory IDs (informational)
    const promptResult = await promptRepo.deleteOldPrompts(cutoff);

    // Step 2: Fetch stale memories (single batch of 1000; known limitation — see SPEC §3.4)
    const oldMemories = await memoryRepo.listOlderThan(cutoff, 1000, 0);

    // Step 3: Iterate, protect, delete, tally
    let deletedMemories = 0;
    let deletedUser = 0;
    let deletedProject = 0;

    for (const mem of oldMemories) {
      // Protection P1: pinned memories are never deleted
      if (mem.isPinned) continue;

      // Protection P2: memories derived from a user prompt are preserved
      if (mem.metadata?.promptId != null) continue;

      // Delete the memory
      await memoryRepo.delete(mem.id);
      deletedMemories++;

      // Classify scope from containerTag
      if (mem.containerTag.includes("_user_")) {
        deletedUser++;
      } else {
        deletedProject++;
      }
    }

    return {
      success: true,
      data: {
        deletedMemories,
        deletedMemoriesUser: deletedUser,
        deletedMemoriesProject: deletedProject,
        deletedPrompts: promptResult.deleted,
      },
    };
  } catch (error) {
    log("handleCleanup: error", { error: String(error) });
    return { success: false, error: String(error) };
  } finally {
    _cleanupInProgress = false;
  }
}

export async function handleDeduplicate(): Promise<
  ApiResponse<{
    totalChecked: number;
    groupsChecked: number;
    duplicatesFound: number;
    duplicatesRemoved: number;
  }>
> {
  if (_dedupInProgress) {
    return { success: false, error: "Deduplication is already in progress" };
  }
  _dedupInProgress = true;

  try {
    await ensureInit();

    // Load all memories with embedding vectors.
    // getAllWithVectors() is explicitly designed for pairwise similarity checks
    // (see types.ts:143 comment).
    const memories = await memoryRepo.getAllWithVectors();

    if (memories.length === 0) {
      return {
        success: true,
        data: {
          totalChecked: 0,
          groupsChecked: 0,
          duplicatesFound: 0,
          duplicatesRemoved: 0,
        },
      };
    }

    // ── Step 1: Group by containerTag to enforce profile/project boundaries ──
    // containerTag encodes scope (user/project) and identity, so memories in
    // different groups must NEVER be compared or merged.
    const groups = new Map<string, MemoryRecord[]>();
    for (const mem of memories) {
      const key = mem.containerTag;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(mem);
    }

    // ── Step 2: Detect duplicate clusters within each group ──
    // Algorithm:
    //   • Compute pairwise cosine similarity on content embedding vectors.
    //   • If similarity ≥ threshold (0.95), mark the pair as duplicates.
    //   • Use union-find to build transitive closure (if A≈B and B≈C, all three
    //     belong to the same duplicate cluster).
    //   • Per cluster, keep the most-recently-updated memory and delete the rest.
    //
    // Threshold rationale: 0.95 cosine similarity on embedding vectors indicates
    // near-identical semantic content.  This is conservative — only clearly
    // redundant copies are removed.
    const SIMILARITY_THRESHOLD = 0.95;

    let totalChecked = 0;
    let duplicatesFound = 0;
    let duplicatesRemoved = 0;

    for (const [, group] of groups) {
      if (group.length < 2) continue;
      totalChecked += group.length;

      // Union-Find
      const parent = new Int32Array(group.length);
      for (let i = 0; i < group.length; i++) parent[i] = i;

      const find = (x: number): number => {
        while (parent[x]! !== x) {
          parent[x] = parent[parent[x]!]!; // path compression
          x = parent[x]!;
        }
        return x;
      };

      const union = (a: number, b: number): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb!;
      };

      // Pairwise comparison within the group
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const sim = cosineSimilarity(group[i]!.vector, group[j]!.vector);
          if (sim >= SIMILARITY_THRESHOLD) {
            union(i, j);
          }
        }
      }

      // Collect clusters
      const clusters = new Map<number, number[]>();
      for (let i = 0; i < group.length; i++) {
        const root = find(i);
        if (!clusters.has(root)) clusters.set(root, []);
        clusters.get(root)!.push(i);
      }

      // For each cluster with >1 member: keep most recent, delete the rest
      for (const [, indices] of clusters) {
        if (indices.length < 2) continue;
        duplicatesFound += indices.length - 1;

        // Sort descending by updatedAt — first item is kept
        indices.sort((a, b) => group[b]!.updatedAt - group[a]!.updatedAt);

        // Delete all except the most recently updated
        for (let k = 1; k < indices.length; k++) {
          try {
            await memoryRepo.delete(group[indices[k]!]!.id);
            duplicatesRemoved++;
          } catch (e) {
            log("handleDeduplicate: failed to delete duplicate", {
              id: group[indices[k]!]!.id,
              error: String(e),
            });
          }
        }
      }
    }

    log("handleDeduplicate: completed", {
      totalChecked,
      groupsChecked: groups.size,
      duplicatesFound,
      duplicatesRemoved,
    });

    return {
      success: true,
      data: {
        totalChecked,
        groupsChecked: groups.size,
        duplicatesFound,
        duplicatesRemoved,
      },
    };
  } catch (error) {
    logError("handleDeduplicate: error", { error: String(error) });
    return { success: false, error: String(error) };
  } finally {
    _dedupInProgress = false;
  }
}

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns a value in [-1, 1], where 1 = identical direction.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function handleMigrationRun(_body: {
  strategy: string;
}): ApiResponse<{ deletedShards?: number; reEmbeddedMemories?: number; duration: number }> {
  return { success: false, error: "Migration run not yet implemented" };
}

// ── List all user profiles ───────────────────────────────

export async function handleListUserProfiles(): Promise<
  ApiResponse<{
    profiles: Array<{ userId: string; displayName: string; userEmail: string }>;
    defaultUserId: string;
  }>
> {
  try {
    await ensureInit();
    const { getTags } = await import("./tags.js");
    const tags = await getTags(process.cwd());
    const defaultUserId = tags.user.userEmail || "unknown";

    const profiles = await profileRepo.getAllActiveProfiles();
    const list = profiles.map((p) => ({
      userId: p.userId,
      displayName: p.displayName || p.userId,
      userEmail: p.userEmail || p.userId,
    }));

    return {
      success: true,
      data: { profiles: list, defaultUserId },
    };
  } catch (error) {
    log("handleListUserProfiles: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleResetTagMigration(): Promise<ApiResponse> {
  migrationProgress = {
    processed: 0,
    total: 0,
    currentBatch: 0,
    totalBatches: 0,
    isComplete: true,
    errors: [],
  };
  _migrationRunning = false;
  cachedMigrationRecords = null;
  // Also delete the persisted marker file
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dataDir = CONFIG.storagePath || "/tmp/opencode-memnet-data";
    await fs.unlink(path.join(dataDir, ".migration", "tag-migration.json"));
  } catch {
    /* file may not exist */
  }
  return { success: true };
}

// ── Client Identity Handlers ───────────────────────────────

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
