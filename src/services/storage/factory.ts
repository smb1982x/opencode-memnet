/**
 * Storage factory: creates Postgres repository singletons.
 *
 * All heavy imports are deferred via dynamic import to avoid loading
 * the postgres client until the first repository method is called.
 */

import { CONFIG } from "../../config.js";
import type {
  AISessionRepository,
  AIMessageRow,
  AISessionRow,
  MemoryRecord,
  MemoryRepository,
  MemoryRow,
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

/**
 * Initialize all repositories. Call once at startup.
 */
export async function initializeStorage(): Promise<{
  memoryRepo: MemoryRepository;
  promptRepo: UserPromptRepository;
  profileRepo: UserProfileRepository;
  sessionRepo: AISessionRepository;
}> {
  const mem = createMemoryRepository();
  const prompt = createUserPromptRepository();
  const profile = createUserProfileRepository();
  const session = createAISessionRepository();

  await mem.initialize();
  await prompt.initialize();
  await profile.initialize();
  await session.initialize();

  return {
    memoryRepo: mem,
    promptRepo: prompt,
    profileRepo: profile,
    sessionRepo: session,
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
}

// ── Lazy Postgres proxies ──
// Dynamic imports ensure the postgres client is only loaded on first use.

class PostgresMemoryRepositoryLazy implements MemoryRepository {
  private target: Promise<MemoryRepository> | null = null;

  private async repo(): Promise<MemoryRepository> {
    if (!this.target) {
      this.target = import("./postgres/memory-repository.js").then(
        ({ PostgresMemoryRepository }) => new PostgresMemoryRepository()
      );
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
  async getDistinctTags(
    args?: Parameters<MemoryRepository["getDistinctTags"]>[0]
  ): Promise<TagInfo[]> {
    return (await this.repo()).getDistinctTags(args);
  }
  async pin(memoryId: string): Promise<void> {
    await (await this.repo()).pin(memoryId);
  }
  async unpin(memoryId: string): Promise<void> {
    await (await this.repo()).unpin(memoryId);
  }
  async listOlderThan(cutoffTime: number): Promise<MemoryRow[]> {
    return (await this.repo()).listOlderThan(cutoffTime);
  }
  async getAllWithVectors(): Promise<MemoryRecord[]> {
    return (await this.repo()).getAllWithVectors();
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
      this.target = import("./postgres/prompt-repository.js").then(
        ({ PostgresUserPromptRepository }) => new PostgresUserPromptRepository()
      );
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
      this.target = import("./postgres/profile-repository.js").then(
        ({ PostgresUserProfileRepository }) => new PostgresUserProfileRepository()
      );
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

  mergeProfileData(existing: UserProfileData, updates: Partial<UserProfileData>): UserProfileData {
    // Synchronous: inline the same pure merge logic as PostgresUserProfileRepository.
    const ensureArray = (val: unknown): any[] => {
      if (typeof val === "string") {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return Array.isArray(val) ? val : [];
    };

    const merged: UserProfileData = {
      preferences: ensureArray(existing?.preferences),
      patterns: ensureArray(existing?.patterns),
      workflows: ensureArray(existing?.workflows),
    };

    if (updates.preferences) {
      const incomingPrefs = ensureArray(updates.preferences);
      for (const newPref of incomingPrefs) {
        const existingIndex = merged.preferences.findIndex(
          (p) => p.category === newPref.category && p.description === newPref.description
        );
        if (existingIndex >= 0) {
          const existingItem = merged.preferences[existingIndex];
          if (existingItem) {
            merged.preferences[existingIndex] = {
              ...newPref,
              confidence: Math.min(1, (existingItem.confidence || 0) + 0.1),
              evidence: [
                ...new Set([
                  ...ensureArray(existingItem.evidence),
                  ...ensureArray(newPref.evidence),
                ]),
              ].slice(0, 5),
              lastUpdated: Date.now(),
            };
          }
        } else {
          merged.preferences.push({ ...newPref, lastUpdated: Date.now() });
        }
      }
      merged.preferences.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      merged.preferences = merged.preferences.slice(0, CONFIG.userProfileMaxPreferences);
    }

    if (updates.patterns) {
      const incomingPatterns = ensureArray(updates.patterns);
      for (const newPattern of incomingPatterns) {
        const existingIndex = merged.patterns.findIndex(
          (p) => p.category === newPattern.category && p.description === newPattern.description
        );
        if (existingIndex >= 0) {
          const existingItem = merged.patterns[existingIndex];
          if (existingItem) {
            merged.patterns[existingIndex] = {
              ...newPattern,
              frequency: (existingItem.frequency || 1) + 1,
              lastSeen: Date.now(),
            };
          }
        } else {
          merged.patterns.push({ ...newPattern, frequency: 1, lastSeen: Date.now() });
        }
      }
      merged.patterns.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
      merged.patterns = merged.patterns.slice(0, CONFIG.userProfileMaxPatterns);
    }

    if (updates.workflows) {
      const incomingWorkflows = ensureArray(updates.workflows);
      for (const newWorkflow of incomingWorkflows) {
        const existingIndex = merged.workflows.findIndex(
          (w) => w.description === newWorkflow.description
        );
        if (existingIndex >= 0) {
          const existingItem = merged.workflows[existingIndex];
          if (existingItem) {
            merged.workflows[existingIndex] = {
              ...newWorkflow,
              frequency: (existingItem.frequency || 1) + 1,
            };
          }
        } else {
          merged.workflows.push({ ...newWorkflow, frequency: 1 });
        }
      }
      merged.workflows.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
      merged.workflows = merged.workflows.slice(0, CONFIG.userProfileMaxWorkflows);
    }

    return merged;
  }
}

class PostgresAISessionRepositoryLazy implements AISessionRepository {
  private target: Promise<AISessionRepository> | null = null;

  private async repo(): Promise<AISessionRepository> {
    if (!this.target) {
      this.target = import("./postgres/ai-session-repository.js").then(
        ({ PostgresAISessionRepository }) => new PostgresAISessionRepository()
      );
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
  async addMessage(message: Omit<AIMessageRow, "id" | "createdAt">): Promise<void> {
    await (await this.repo()).addMessage(message);
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
