import { embeddingService } from "./embedding.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";
import type { MemoryType } from "../types/index.js";
import {
  createMemoryRepository,
  createUserPromptRepository,
  createUserProfileRepository,
} from "./storage/factory.js";
import type {
  MemoryRepository,
  UserPromptRepository,
  UserProfileRepository,
  MemoryRow,
  MemoryRecord,
  MemoryScopeKind,
} from "./storage/types.js";

const memoryRepo: MemoryRepository = createMemoryRepository();
const promptRepo: UserPromptRepository = createUserPromptRepository();
const profileRepo: UserProfileRepository = createUserProfileRepository();

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
    })();
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
    return { success: true, data: { project: projectTags } };
  } catch (error) {
    log("handleListTags: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function handleListMemories(
  tag?: string,
  page: number = 1,
  pageSize: number = 20,
  includePrompts: boolean = true
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
      });
    } else {
      memoryRows = await memoryRepo.list({
        scope: "project",
        scopeHash: "",
        containerTag: "",
        includeAllContainers: true,
        limit: 100000,
      });
      memoryRows = memoryRows.filter((m) => m.containerTag.includes("_project_"));
    }

    const memoriesWithType = memoryRows.map((r) => ({
      type: "memory" as const,
      id: r.id,
      content: r.content,
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
      .sort((a, b) => b.memory.createdAt - a.memory.createdAt);
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
    standalone.sort((a, b) => b.createdAt - a.createdAt);
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
    if (cascade) {
      const linkedPromptId = memory.metadata?.promptId as string | undefined;
      if (linkedPromptId) await promptRepo.deletePrompt(linkedPromptId);
    }
    await memoryRepo.delete(id);
    return {
      success: true,
      data: { deletedPrompt: cascade && !!memory.metadata?.promptId },
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
  data: { content?: string; type?: MemoryType; tags?: string[] }
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
      containerTag: existingMemory.containerTag,
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
  pageSize: number = 20
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

    // Compute total/totalPages AFTER appending linked extras
    const total = paginatedResults.length;
    const totalPages = Math.max(1, Math.ceil(combinedResults.length / pageSize));
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
    const untaggedCount = await memoryRepo.countUntagged();
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

let migrationProgress: MigrationProgress = {
  processed: 0,
  total: 0,
  currentBatch: 0,
  totalBatches: 0,
  isComplete: true,
  errors: [],
};

export async function handleGetTagMigrationProgress(): Promise<ApiResponse<MigrationProgress>> {
  return { success: true, data: { ...migrationProgress } };
}

export async function handleRunTagMigrationBatch(
  batchSize: number = 5
): Promise<ApiResponse<{ processed: number; total: number; hasMore: boolean }>> {
  try {
    await ensureInit();
    // Only (re)initialize when starting a fresh migration:
    // either no migration has started yet, or the previous one completed.
    if (migrationProgress.isComplete || migrationProgress.total === 0) {
      migrationProgress = {
        processed: 0,
        total: 0,
        currentBatch: 0,
        totalBatches: 0,
        isComplete: false,
        errors: [],
      };
    }
    const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
    const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");
    const providerConfig = buildMemoryProviderConfig(CONFIG, {
      maxIterations: 1,
      iterationTimeout: 30000,
    });
    const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);

    const allRecords = (await memoryRepo.getAllWithVectors()).filter((record) =>
      record.containerTag.includes("_project_")
    );

    migrationProgress.total = allRecords.length;
    migrationProgress.totalBatches = Math.ceil(allRecords.length / batchSize);

    let batchProcessed = 0;
    const startIdx = migrationProgress.processed;
    const endIdx = Math.min(startIdx + batchSize, allRecords.length);

    for (let i = startIdx; i < endIdx; i++) {
      const m = allRecords[i];
      if (!m) continue;

      try {
        let currentTags = m.tags
          ? m.tags
              .split(",")
              .map((t: string) => t.trim().toLowerCase())
              .filter((t: string) => t)
          : [];

        if (currentTags.length === 0) {
          const prompt = `Generate 2-4 short technical tags for this memory content:\n\n${m.content}\n\nReturn ONLY a comma-separated list of tags.`;
          const result = await provider.executeToolCall(
            "You are a technical tagger.",
            prompt,
            {
              type: "function",
              function: {
                name: "save_tags",
                description: "Save generated tags",
                parameters: {
                  type: "object",
                  properties: { tags: { type: "array", items: { type: "string" } } },
                  required: ["tags"],
                },
              },
            },
            `migration_${m.id}`
          );
          if (result.success && result.data?.tags) {
            currentTags = result.data.tags;
          }
        }

        const vector = await embeddingService.embedWithTimeout(m.content, { kind: "content" });
        const tagsVector = currentTags.length
          ? await embeddingService.embedWithTimeout(currentTags.join(", "), { kind: "tags" })
          : undefined;

        await memoryRepo.updateTagsAndVectors(
          m.id,
          currentTags.join(","),
          vector,
          tagsVector,
          Date.now()
        );

        migrationProgress.processed++;
        batchProcessed++;
      } catch (e) {
        const errorMsg = String(e);
        migrationProgress.errors.push(errorMsg);
        log("Migration error for memory", { id: m.id, error: errorMsg });
      }
    }

    migrationProgress.currentBatch++;
    const hasMore = migrationProgress.processed < migrationProgress.total;

    if (!hasMore) {
      migrationProgress.isComplete = true;
    }

    return {
      success: true,
      data: { processed: migrationProgress.processed, total: migrationProgress.total, hasMore },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
