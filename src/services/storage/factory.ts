/**
 * Storage factory: creates Postgres repository singletons.
 *
 * All heavy imports are deferred via dynamic import to avoid loading
 * the postgres client until the first repository method is called.
 */

import { CONFIG } from "../../config.js";
import { mergeProfileData as sharedMergeProfileData } from "./postgres/profile-utils.js";
import type {
  AISessionRepository,
  AIMessageRow,
  AISessionRow,
  ClientRepository,
  ClientRow,
  MemoryRecord,
  MemoryRepository,
  MemoryRow,
  MemoryScopeKind,
  MemorySearchOptions,
  SearchResult,
  TagInfo,
  UserProfileChangelogRow,
  UserProfileData,
  UserProfileRepository,
  UserProfileRow,
  UserPromptRepository,
  UserPromptRow,
} from "./types.js";

// ── Singleton instances (lazily created, cached for the process lifetime) ──

let memoryRepo: MemoryRepository | null = null;
let promptRepo: UserPromptRepository | null = null;
let profileRepo: UserProfileRepository | null = null;
let sessionRepo: AISessionRepository | null = null;
let clientRepo: ClientRepository | null = null;

export function createMemoryRepository(): MemoryRepository {
  if (memoryRepo) return memoryRepo;
  memoryRepo = new PostgresMemoryRepositoryLazy();
  return memoryRepo;
}

export function createUserPromptRepository(): UserPromptRepository {
  if (promptRepo) return promptRepo;
  promptRepo = new PostgresUserPromptRepositoryLazy();
  return promptRepo;
}

export function createUserProfileRepository(): UserProfileRepository {
  if (profileRepo) return profileRepo;
  profileRepo = new PostgresUserProfileRepositoryLazy();
  return profileRepo;
}

export function createAISessionRepository(): AISessionRepository {
  if (sessionRepo) return sessionRepo;
  sessionRepo = new PostgresAISessionRepositoryLazy();
  return sessionRepo;
}

export function createClientRepository(): ClientRepository {
  if (clientRepo) return clientRepo;
  clientRepo = new PostgresClientRepositoryLazy();
  return clientRepo;
}

/**
 * Initialize all repositories. Call once at startup.
 */
export async function initializeStorage(): Promise<{
  memoryRepo: MemoryRepository;
  promptRepo: UserPromptRepository;
  profileRepo: UserProfileRepository;
  sessionRepo: AISessionRepository;
  clientRepo: ClientRepository;
}> {
  const mem = createMemoryRepository();
  const prompt = createUserPromptRepository();
  const profile = createUserProfileRepository();
  const session = createAISessionRepository();
  const client = createClientRepository();

  await mem.initialize();
  await prompt.initialize();
  await profile.initialize();
  await session.initialize();
  await client.initialize();

  return {
    memoryRepo: mem,
    promptRepo: prompt,
    profileRepo: profile,
    sessionRepo: session,
    clientRepo: client,
  };
}

/**
 * Close all repositories. Call once at shutdown. Idempotent.
 */
export async function closeStorage(): Promise<void> {
  if (memoryRepo) {
    await memoryRepo.close();
    memoryRepo = null;
  }
  if (promptRepo) {
    await promptRepo.close();
    promptRepo = null;
  }
  if (profileRepo) {
    await profileRepo.close();
    profileRepo = null;
  }
  if (sessionRepo) {
    await sessionRepo.close();
    sessionRepo = null;
  }
  if (clientRepo) {
    await clientRepo.close();
    clientRepo = null;
  }
}

// ── Lazy Postgres proxies ──
// Dynamic imports ensure the postgres client is only loaded on first use.

class PostgresMemoryRepositoryLazy implements MemoryRepository {
  private target: Promise<MemoryRepository> | null = null;

  private async repo(): Promise<MemoryRepository> {
    if (!this.target) {
      this.target = import("./postgres/memory-repository.js")
        .then(({ PostgresMemoryRepository }) => new PostgresMemoryRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async insert(record: MemoryRecord): Promise<void> {
    await (await this.repo()).insert(record);
  }
  async delete(memoryId: string): Promise<boolean> {
    return (await this.repo()).delete(memoryId);
  }
  async update(record: MemoryRecord): Promise<void> {
    await (await this.repo()).update(record);
  }
  async getById(memoryId: string): Promise<MemoryRow | null> {
    return (await this.repo()).getById(memoryId);
  }
  async search(options: MemorySearchOptions): Promise<SearchResult[]> {
    return (await this.repo()).search(options);
  }
  async list(args: Parameters<MemoryRepository["list"]>[0]): Promise<MemoryRow[]> {
    return (await this.repo()).list(args);
  }
  async getBySessionId(
    args: Parameters<MemoryRepository["getBySessionId"]>[0]
  ): Promise<SearchResult[]> {
    return (await this.repo()).getBySessionId(args);
  }
  async count(args?: Parameters<MemoryRepository["count"]>[0]): Promise<number> {
    return (await this.repo()).count(args);
  }
  async countByType(): Promise<Record<string, number>> {
    return (await this.repo()).countByType();
  }
  async getDistinctTags(
    args?: Parameters<MemoryRepository["getDistinctTags"]>[0]
  ): Promise<TagInfo[]> {
    return (await this.repo()).getDistinctTags(args);
  }
  async getDistinctTagValues(args?: { scope?: MemoryScopeKind }): Promise<string[]> {
    return (await this.repo()).getDistinctTagValues(args);
  }
  async pin(memoryId: string): Promise<void> {
    await (await this.repo()).pin(memoryId);
  }
  async unpin(memoryId: string): Promise<void> {
    await (await this.repo()).unpin(memoryId);
  }
  async listOlderThan(cutoffTime: number, limit?: number, offset?: number): Promise<MemoryRow[]> {
    return (await this.repo()).listOlderThan(cutoffTime, limit, offset);
  }
  async getAllWithVectors(limit?: number, offset?: number): Promise<MemoryRecord[]> {
    return (await this.repo()).getAllWithVectors(limit, offset);
  }
  async countUntagged(): Promise<number> {
    return (await this.repo()).countUntagged();
  }
  async updateTagsAndVectors(
    id: string,
    tags: string,
    vector: Float32Array,
    tagsVector: Float32Array | undefined,
    updatedAt: number
  ): Promise<void> {
    await (await this.repo()).updateTagsAndVectors(id, tags, vector, tagsVector, updatedAt);
  }
}

class PostgresUserPromptRepositoryLazy implements UserPromptRepository {
  private target: Promise<UserPromptRepository> | null = null;

  private async repo(): Promise<UserPromptRepository> {
    if (!this.target) {
      this.target = import("./postgres/prompt-repository.js")
        .then(({ PostgresUserPromptRepository }) => new PostgresUserPromptRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async savePrompt(
    sessionId: string,
    messageId: string,
    projectPath: string,
    content: string
  ): Promise<string> {
    return (await this.repo()).savePrompt(sessionId, messageId, projectPath, content);
  }
  async getLastUncapturedPrompt(sessionId: string): Promise<UserPromptRow | null> {
    return (await this.repo()).getLastUncapturedPrompt(sessionId);
  }
  async deletePrompt(promptId: string): Promise<void> {
    await (await this.repo()).deletePrompt(promptId);
  }
  async markAsCaptured(promptId: string): Promise<void> {
    await (await this.repo()).markAsCaptured(promptId);
  }
  async claimPrompt(promptId: string): Promise<boolean> {
    return (await this.repo()).claimPrompt(promptId);
  }
  async releasePrompt(promptId: string): Promise<void> {
    await (await this.repo()).releasePrompt(promptId);
  }
  async countUncapturedPrompts(): Promise<number> {
    return (await this.repo()).countUncapturedPrompts();
  }
  async getUncapturedPrompts(limit: number): Promise<UserPromptRow[]> {
    return (await this.repo()).getUncapturedPrompts(limit);
  }
  async markMultipleAsCaptured(promptIds: string[]): Promise<void> {
    await (await this.repo()).markMultipleAsCaptured(promptIds);
  }
  async countUnanalyzedForUserLearning(): Promise<number> {
    return (await this.repo()).countUnanalyzedForUserLearning();
  }
  async getPromptsForUserLearning(limit: number): Promise<UserPromptRow[]> {
    return (await this.repo()).getPromptsForUserLearning(limit);
  }
  async markAsUserLearningCaptured(promptId: string): Promise<void> {
    await (await this.repo()).markAsUserLearningCaptured(promptId);
  }
  async markMultipleAsUserLearningCaptured(promptIds: string[]): Promise<void> {
    await (await this.repo()).markMultipleAsUserLearningCaptured(promptIds);
  }
  async deleteOldPrompts(
    cutoffTime: number
  ): Promise<{ deleted: number; linkedMemoryIds: string[] }> {
    return (await this.repo()).deleteOldPrompts(cutoffTime);
  }
  async linkMemoryToPrompt(promptId: string, memoryId: string): Promise<void> {
    await (await this.repo()).linkMemoryToPrompt(promptId, memoryId);
  }
  async getPromptById(promptId: string): Promise<UserPromptRow | null> {
    return (await this.repo()).getPromptById(promptId);
  }
  async getCapturedPrompts(projectPath?: string): Promise<UserPromptRow[]> {
    return (await this.repo()).getCapturedPrompts(projectPath);
  }
  async searchPrompts(
    query: string,
    projectPath?: string,
    limit?: number
  ): Promise<UserPromptRow[]> {
    return (await this.repo()).searchPrompts(query, projectPath, limit);
  }
  async getPromptsByIds(ids: string[]): Promise<UserPromptRow[]> {
    return (await this.repo()).getPromptsByIds(ids);
  }
}

class PostgresUserProfileRepositoryLazy implements UserProfileRepository {
  private target: Promise<UserProfileRepository> | null = null;

  private async repo(): Promise<UserProfileRepository> {
    if (!this.target) {
      this.target = import("./postgres/profile-repository.js")
        .then(({ PostgresUserProfileRepository }) => new PostgresUserProfileRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async getActiveProfile(userId: string): Promise<UserProfileRow | null> {
    return (await this.repo()).getActiveProfile(userId);
  }
  async getProfileById(profileId: string): Promise<UserProfileRow | null> {
    return (await this.repo()).getProfileById(profileId);
  }
  async getAllActiveProfiles(): Promise<UserProfileRow[]> {
    return (await this.repo()).getAllActiveProfiles();
  }
  async createProfile(
    userId: string,
    displayName: string,
    userName: string,
    userEmail: string,
    profileData: UserProfileData,
    promptsAnalyzed: number
  ): Promise<string> {
    return (await this.repo()).createProfile(
      userId,
      displayName,
      userName,
      userEmail,
      profileData,
      promptsAnalyzed
    );
  }
  async updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string
  ): Promise<void> {
    await (
      await this.repo()
    ).updateProfile(profileId, profileData, additionalPromptsAnalyzed, changeSummary);
  }
  async deleteProfile(profileId: string): Promise<void> {
    await (await this.repo()).deleteProfile(profileId);
  }
  async applyConfidenceDecay(profileId: string): Promise<void> {
    await (await this.repo()).applyConfidenceDecay(profileId);
  }
  async getProfileChangelogs(
    profileId: string,
    limit?: number
  ): Promise<UserProfileChangelogRow[]> {
    return (await this.repo()).getProfileChangelogs(profileId, limit);
  }
  async getChangelogById(changelogId: string): Promise<UserProfileChangelogRow | null> {
    return (await this.repo()).getChangelogById(changelogId);
  }

  mergeProfileData(existing: UserProfileData, updates: Partial<UserProfileData>): UserProfileData {
    return sharedMergeProfileData(existing, updates, {
      maxPreferences: CONFIG.userProfileMaxPreferences,
      maxPatterns: CONFIG.userProfileMaxPatterns,
      maxWorkflows: CONFIG.userProfileMaxWorkflows,
    });
  }
}

class PostgresAISessionRepositoryLazy implements AISessionRepository {
  private target: Promise<AISessionRepository> | null = null;

  private async repo(): Promise<AISessionRepository> {
    if (!this.target) {
      this.target = import("./postgres/ai-session-repository.js")
        .then(({ PostgresAISessionRepository }) => new PostgresAISessionRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async getSession(sessionId: string, provider: string): Promise<AISessionRow | null> {
    return (await this.repo()).getSession(sessionId, provider);
  }
  async createSession(params: {
    provider: string;
    sessionId: string;
    conversationId?: string;
    metadata?: Record<string, any>;
  }): Promise<AISessionRow> {
    return (await this.repo()).createSession(params);
  }
  async updateSession(
    sessionId: string,
    provider: string,
    updates: { conversationId?: string; metadata?: Record<string, any> }
  ): Promise<void> {
    await (await this.repo()).updateSession(sessionId, provider, updates);
  }
  async deleteSession(sessionId: string, provider: string): Promise<void> {
    await (await this.repo()).deleteSession(sessionId, provider);
  }
  async cleanupExpiredSessions(): Promise<number> {
    return (await this.repo()).cleanupExpiredSessions();
  }
  async addMessage(
    message: Omit<AIMessageRow, "id" | "createdAt" | "sequence"> & { sequence?: number }
  ): Promise<number> {
    return (await this.repo()).addMessage(message);
  }
  async getMessages(aiSessionId: string): Promise<AIMessageRow[]> {
    return (await this.repo()).getMessages(aiSessionId);
  }
  async getLastSequence(aiSessionId: string): Promise<number> {
    return (await this.repo()).getLastSequence(aiSessionId);
  }
  async clearMessages(aiSessionId: string): Promise<void> {
    await (await this.repo()).clearMessages(aiSessionId);
  }
}

class PostgresClientRepositoryLazy implements ClientRepository {
  private target: Promise<ClientRepository> | null = null;

  private async repo(): Promise<ClientRepository> {
    if (!this.target) {
      this.target = import("./postgres/client-repository.js")
        .then(({ PostgresClientRepository }) => new PostgresClientRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target!;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async upsertClient(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<{ firstTime: boolean; previousLastSeen: number | null; row: ClientRow }> {
    return (await this.repo()).upsertClient(id, metadata);
  }
  async setNickname(id: string, nickname: string): Promise<ClientRow | null> {
    return (await this.repo()).setNickname(id, nickname);
  }
  async getClient(id: string): Promise<ClientRow | null> {
    return (await this.repo()).getClient(id);
  }
  async getClientStats(id: string): Promise<{
    client: ClientRow | null;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }> {
    return (await this.repo()).getClientStats(id);
  }
}
