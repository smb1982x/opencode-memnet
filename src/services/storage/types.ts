/**
 * Storage repository interfaces and shared types for the storage abstraction layer.
 */

export type MemoryScopeKind = "user" | "project";

// ── Search and query types ──

export interface MemorySearchOptions {
  queryVector: Float32Array;
  queryText?: string;
  scope: MemoryScopeKind;
  scopeHash: string;
  containerTag: string;
  includeAllContainers?: boolean;
  limit: number;
  similarityThreshold: number;
  userEmail?: string;
}

// ── Row / result types ──

export interface MemoryRow {
  id: string;
  content: string;
  containerTag: string;
  tags: string[];
  type?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
}

export interface SearchResult {
  id: string;
  memory: string;
  similarity: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
  containerTag?: string;
  createdAt?: number;
}

export interface TagInfo {
  tag: string;
  tags?: string[];
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

export interface MemoryRecord {
  id: string;
  content: string;
  vector: Float32Array;
  tagsVector?: Float32Array;
  containerTag: string;
  tags?: string;
  type?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

// ── Memory repository interface ──

export interface MemoryRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  insert(record: MemoryRecord): Promise<void>;
  delete(memoryId: string): Promise<boolean>;
  update(record: MemoryRecord): Promise<void>;
  getById(memoryId: string): Promise<MemoryRow | null>;

  search(options: MemorySearchOptions): Promise<SearchResult[]>;

  list(args: {
    scope: MemoryScopeKind;
    scopeHash: string;
    containerTag: string;
    includeAllContainers?: boolean;
    limit: number;
    userEmail?: string;
  }): Promise<MemoryRow[]>;

  getBySessionId(args: {
    sessionId: string;
    scope: MemoryScopeKind;
    scopeHash: string;
    limit: number;
  }): Promise<SearchResult[]>;

  count(args?: {
    containerTag?: string;
    scope?: MemoryScopeKind;
    scopeHash?: string;
  }): Promise<number>;

  /**
   * Returns a breakdown of memory counts grouped by type.
   * Used by handleStats to avoid loading all rows into memory.
   */
  countByType(): Promise<Record<string, number>>;

  getDistinctTags(args?: { scope?: MemoryScopeKind; scopeHash?: string }): Promise<TagInfo[]>;

  pin(memoryId: string): Promise<void>;
  unpin(memoryId: string): Promise<void>;

  /**
   * Returns memories whose `updatedAt` is older than `cutoffTime`.
   * Used by cleanup-service to identify stale memories.
   */
  listOlderThan(cutoffTime: number, limit?: number, offset?: number): Promise<MemoryRow[]>;

  /**
   * Returns all memory records including their raw Float32Array vectors.
   * Used by deduplication-service for pairwise similarity checks.
   */
  getAllWithVectors(limit?: number, offset?: number): Promise<MemoryRecord[]>;

  /**
   * Count project memories with NULL or empty tags column.
   * Used by tag-migration detection.
   */
  countUntagged(): Promise<number>;

  /**
   * Update the tags column, re-embed and overwrite vector/tags_vector blobs,
   * set updated_at, and refresh the vector backend index.
   * Used by tag-migration batch processing.
   */
  updateTagsAndVectors(
    id: string,
    tags: string,
    vector: Float32Array,
    tagsVector: Float32Array | undefined,
    updatedAt: number
  ): Promise<void>;
}

// ── User prompt repository interface ──

export interface UserPromptRow {
  id: string;
  sessionId: string;
  messageId: string;
  projectPath: string | null;
  content: string;
  createdAt: number;
  captured: number; // 0=uncaptured, 1=captured, 2=claimed
  userLearningCaptured: boolean;
  linkedMemoryId: string | null;
}

export interface UserPromptRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  savePrompt(
    sessionId: string,
    messageId: string,
    projectPath: string,
    content: string
  ): Promise<string>;
  getLastUncapturedPrompt(sessionId: string): Promise<UserPromptRow | null>;
  deletePrompt(promptId: string): Promise<void>;
  markAsCaptured(promptId: string): Promise<void>;
  claimPrompt(promptId: string): Promise<boolean>;
  releasePrompt(promptId: string): Promise<void>;
  countUncapturedPrompts(): Promise<number>;
  getUncapturedPrompts(limit: number): Promise<UserPromptRow[]>;
  markMultipleAsCaptured(promptIds: string[]): Promise<void>;
  countUnanalyzedForUserLearning(): Promise<number>;
  getPromptsForUserLearning(limit: number): Promise<UserPromptRow[]>;
  markAsUserLearningCaptured(promptId: string): Promise<void>;
  markMultipleAsUserLearningCaptured(promptIds: string[]): Promise<void>;
  deleteOldPrompts(cutoffTime: number): Promise<{ deleted: number; linkedMemoryIds: string[] }>;
  linkMemoryToPrompt(promptId: string, memoryId: string): Promise<void>;
  getPromptById(promptId: string): Promise<UserPromptRow | null>;
  getCapturedPrompts(projectPath?: string): Promise<UserPromptRow[]>;
  searchPrompts(query: string, projectPath?: string, limit?: number): Promise<UserPromptRow[]>;
  getPromptsByIds(ids: string[]): Promise<UserPromptRow[]>;
}

// ── User profile repository interface ──

export interface UserProfileData {
  preferences: any[];
  patterns: any[];
  workflows: any[];
}

export interface UserProfileRow {
  id: string;
  userId: string;
  displayName: string;
  userName: string;
  userEmail: string;
  profileData: string;
  version: number;
  createdAt: number;
  lastAnalyzedAt: number;
  totalPromptsAnalyzed: number;
  isActive: boolean;
}

export interface UserProfileChangelogRow {
  id: string;
  profileId: string;
  version: number;
  changeType: string;
  changeSummary: string;
  profileDataSnapshot: string;
  createdAt: number;
}

export interface UserProfileRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  getActiveProfile(userId: string): Promise<UserProfileRow | null>;
  getProfileById(profileId: string): Promise<UserProfileRow | null>;
  getAllActiveProfiles(): Promise<UserProfileRow[]>;
  createProfile(
    userId: string,
    displayName: string,
    userName: string,
    userEmail: string,
    profileData: UserProfileData,
    promptsAnalyzed: number
  ): Promise<string>;
  updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string
  ): Promise<void>;
  deleteProfile(profileId: string): Promise<void>;
  applyConfidenceDecay(profileId: string): Promise<void>;
  getProfileChangelogs(profileId: string, limit?: number): Promise<UserProfileChangelogRow[]>;
  getChangelogById(changelogId: string): Promise<UserProfileChangelogRow | null>;

  /**
   * Merge incoming profile data into the existing data, applying
   * confidence boosting, deduplication, and cap enforcement.
   */
  mergeProfileData(existing: UserProfileData, updates: Partial<UserProfileData>): UserProfileData;
}

// ── AI session repository interface ──

export interface AISessionRow {
  id: string;
  provider: string;
  sessionId: string;
  conversationId?: string;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface AIMessageRow {
  id?: number;
  aiSessionId: string;
  sequence: number;
  role: string;
  content: string;
  toolCalls?: any;
  toolCallId?: string;
  contentBlocks?: any;
  createdAt: number;
}

export interface AISessionRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  getSession(sessionId: string, provider: string): Promise<AISessionRow | null>;
  createSession(params: {
    provider: string;
    sessionId: string;
    conversationId?: string;
    metadata?: Record<string, any>;
  }): Promise<AISessionRow>;
  updateSession(
    sessionId: string,
    provider: string,
    updates: { conversationId?: string; metadata?: Record<string, any> }
  ): Promise<void>;
  deleteSession(sessionId: string, provider: string): Promise<void>;
  cleanupExpiredSessions(): Promise<number>;

  addMessage(
    message: Omit<AIMessageRow, "id" | "createdAt" | "sequence"> & { sequence?: number }
  ): Promise<number>;
  getMessages(aiSessionId: string): Promise<AIMessageRow[]>;
  getLastSequence(aiSessionId: string): Promise<number>;
  clearMessages(aiSessionId: string): Promise<void>;
}
