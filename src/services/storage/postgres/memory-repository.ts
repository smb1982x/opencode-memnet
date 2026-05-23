/**
 * Postgres-backed implementation of MemoryRepository using pgvector.
 *
 * Uses the candidate-union strategy for search: retrieves candidates from
 * both content-vector and tags-vector HNSW indexes, computes final weighted
 * scoring in TypeScript (contentSim * 0.6 + finalTagsSim * 0.4).
 */

import { CONFIG } from "../../../config.js";
import { log } from "../../logger.js";
import { getPostgresClient, closePostgresClient, type SqlClient } from "./client.js";
import { runPostgresMigrations } from "./migrations.js";
import { vectorToPgLiteral, assertVectorDimensions, getVectorCast } from "./vector.js";
import type {
  MemoryRepository,
  MemoryRecord,
  MemoryRow,
  MemorySearchOptions,
  SearchResult,
  TagInfo,
  MemoryScopeKind,
} from "../types.js";

// ── Helpers ──

function extractScopeFromContainerTag(containerTag: string): {
  scope: "user" | "project";
  hash: string;
} {
  const parts = containerTag.split("_");
  if (parts.length >= 3) {
    const scope = parts[1];
    if (scope !== "user" && scope !== "project") {
      throw new Error(`Invalid scope extracted from container tag: ${scope}`);
    }
    const hash = parts.slice(2).join("_");
    return { scope, hash };
  }
  return { scope: "user", hash: containerTag };
}

function parseMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return undefined;
}

function rowToMemoryRow(row: any): MemoryRow {
  return {
    id: row.id,
    content: row.content,
    containerTag: row.container_tag,
    tags: row.tags ? row.tags.split(",").map((t: string) => t.trim()) : [],
    type: row.type ?? undefined,
    metadata: parseMetadata(row.metadata),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    displayName: row.display_name ?? undefined,
    userName: row.user_name ?? undefined,
    userEmail: row.user_email ?? undefined,
    projectPath: row.project_path ?? undefined,
    projectName: row.project_name ?? undefined,
    gitRepoUrl: row.git_repo_url ?? undefined,
    isPinned: row.is_pinned ?? false,
  };
}

function rowToSearchResult(row: any): SearchResult {
  const tagsStr = row.tags || "";
  return {
    id: row.id,
    memory: row.content,
    similarity: row.similarity ?? 1.0,
    tags: tagsStr ? tagsStr.split(",").map((t: string) => t.trim()) : [],
    metadata: parseMetadata(row.metadata),
    containerTag: row.container_tag ?? undefined,
    displayName: row.display_name ?? undefined,
    userName: row.user_name ?? undefined,
    userEmail: row.user_email ?? undefined,
    projectPath: row.project_path ?? undefined,
    projectName: row.project_name ?? undefined,
    gitRepoUrl: row.git_repo_url ?? undefined,
    isPinned: row.is_pinned ?? false,
    createdAt: row.created_at != null ? Number(row.created_at) : undefined,
  };
}

function rowToMemoryRecord(row: any): MemoryRecord {
  // Postgres returns vector columns as strings like "[0.1,0.2,...]"
  const parseVector = (v: unknown): Float32Array => {
    if (v instanceof Float32Array) return v;
    if (typeof v === "string") {
      try {
        return new Float32Array(JSON.parse(v));
      } catch (err) {
        log("Failed to parse stored vector, skipping this memory record", { error: String(err) });
        throw err;
      }
    }
    if (v instanceof Uint8Array) {
      return new Float32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    }
    return new Float32Array(0);
  };

  return {
    id: row.id,
    content: row.content,
    vector: parseVector(row.vector),
    tagsVector: row.tags_vector ? parseVector(row.tags_vector) : undefined,
    containerTag: row.container_tag,
    tags: row.tags ?? undefined,
    type: row.type ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    metadata: typeof row.metadata === "string" ? row.metadata : JSON.stringify(row.metadata ?? {}),
    displayName: row.display_name ?? undefined,
    userName: row.user_name ?? undefined,
    userEmail: row.user_email ?? undefined,
    projectPath: row.project_path ?? undefined,
    projectName: row.project_name ?? undefined,
    gitRepoUrl: row.git_repo_url ?? undefined,
  };
}

// ── Weighted scoring (preserves current formula) ──

function computeWeightedScores(
  rows: any[],
  queryText: string | undefined,
  threshold: number,
  limit: number
): SearchResult[] {
  const queryWords = queryText
    ? queryText
        .toLowerCase()
        .split(/[\s,]+/)
        .filter((w) => w.length > 1)
    : [];

  const results = rows.map((row: any) => {
    const contentSim = Number(row.content_sim);
    const tagsSim = Number(row.tags_sim);
    const memoryTagsStr = row.tags || "";
    const memoryTags: string[] = memoryTagsStr
      .split(",")
      .map((t: string) => t.trim().toLowerCase());

    let exactMatchBoost = 0;
    if (queryWords.length > 0 && memoryTags.length > 0) {
      const matches = queryWords.filter((w) =>
        memoryTags.some((t) => t.includes(w) || w.includes(t))
      ).length;
      exactMatchBoost = matches / Math.max(queryWords.length, 1);
    }

    const finalTagsSim = Math.max(tagsSim, exactMatchBoost);
    const similarity = contentSim * 0.6 + finalTagsSim * 0.4;

    const tagsStr = row.tags || "";
    return {
      id: row.id,
      memory: row.content,
      similarity,
      tags: tagsStr ? tagsStr.split(",").map((t: string) => t.trim()) : [],
      metadata: parseMetadata(row.metadata),
      containerTag: row.container_tag ?? undefined,
      displayName: row.display_name ?? undefined,
      userName: row.user_name ?? undefined,
      userEmail: row.user_email ?? undefined,
      projectPath: row.project_path ?? undefined,
      projectName: row.project_name ?? undefined,
      gitRepoUrl: row.git_repo_url ?? undefined,
      isPinned: row.is_pinned ?? false,
      createdAt: row.created_at != null ? Number(row.created_at) : undefined,
    };
  });

  results.sort((a, b) => b.similarity - a.similarity);
  return results.filter((r) => r.similarity >= threshold).slice(0, limit);
}

// ── Search query builder ──

async function executeSearchQuery(
  sql: SqlClient,
  options: MemorySearchOptions,
  queryLiteral: string,
  vectorCast: string,
  candidateLimit: number
): Promise<any[]> {
  const scopeHashFilter = options.scopeHash || "";
  const containerTagFilter = options.includeAllContainers ? "" : options.containerTag;
  const userEmail = options.userEmail ?? "";

  return sql.unsafe(
    `
    WITH candidates AS (
      (
        SELECT id
        FROM memories
        WHERE scope = $2
          AND ($3::text = '' OR scope_hash = $3)
          AND ($4::text = '' OR container_tag = $4)
          AND ($6::text = '' OR user_email = $6)
        ORDER BY vector <=> $1::${vectorCast}
        LIMIT $5
      )
      UNION
      (
        SELECT id
        FROM memories
        WHERE scope = $2
          AND ($3::text = '' OR scope_hash = $3)
          AND ($4::text = '' OR container_tag = $4)
          AND ($6::text = '' OR user_email = $6)
          AND tags_vector IS NOT NULL
        ORDER BY tags_vector <=> $1::${vectorCast}
        LIMIT $5
      )
    )
    SELECT
      m.*,
      1 - (m.vector <=> $1::${vectorCast}) AS content_sim,
      CASE
        WHEN m.tags_vector IS NULL THEN 0
        ELSE 1 - (m.tags_vector <=> $1::${vectorCast})
      END AS tags_sim
    FROM memories m
    JOIN candidates c ON c.id = m.id
    `,
    [queryLiteral, options.scope, scopeHashFilter, containerTagFilter, candidateLimit, userEmail]
  );
}

// ── Repository ──

export class PostgresMemoryRepository implements MemoryRepository {
  async initialize(): Promise<void> {
    await runPostgresMigrations();
  }

  async close(): Promise<void> {
    await closePostgresClient();
  }

  async insert(record: MemoryRecord): Promise<void> {
    const sql = getPostgresClient();
    const dims = CONFIG.embeddingDimensions;
    const vectorType = CONFIG.postgres!.vectorType ?? "vector";
    const vectorCast = getVectorCast(vectorType, dims);

    assertVectorDimensions(record.vector, dims);
    if (record.tagsVector) {
      assertVectorDimensions(record.tagsVector, dims);
    }

    const { scope, hash } = extractScopeFromContainerTag(record.containerTag);
    const metadata = parseMetadata(record.metadata) ?? {};

    const vectorLit = "'" + vectorToPgLiteral(record.vector) + "'::" + vectorCast;
    const tagsVectorLit = record.tagsVector
      ? "'" + vectorToPgLiteral(record.tagsVector) + "'::" + vectorCast
      : null;

    await sql`
      INSERT INTO memories (
        id, scope, scope_hash, content, vector, tags_vector,
        container_tag, tags, type, created_at, updated_at,
        metadata, display_name, user_name, user_email,
        project_path, project_name, git_repo_url, is_pinned
      ) VALUES (
        ${record.id},
        ${scope},
        ${hash},
        ${record.content},
        ${sql.unsafe(vectorLit)},
        ${tagsVectorLit ? sql.unsafe(tagsVectorLit) : null},
        ${record.containerTag},
        ${record.tags ?? null},
        ${record.type ?? null},
        ${record.createdAt},
        ${record.updatedAt},
        ${sql.json(metadata as any)},
        ${record.displayName ?? null},
        ${record.userName ?? null},
        ${record.userEmail ?? null},
        ${record.projectPath ?? null},
        ${record.projectName ?? null},
        ${record.gitRepoUrl ?? null},
        ${false}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async delete(memoryId: string): Promise<boolean> {
    const sql = getPostgresClient();
    const rows = await sql`
      DELETE FROM memories WHERE id = ${memoryId} RETURNING id
    `;
    return rows.length > 0;
  }

  async update(record: MemoryRecord): Promise<void> {
    const sql = getPostgresClient();
    const dims = CONFIG.embeddingDimensions;
    const vectorType = CONFIG.postgres!.vectorType ?? "vector";
    const vectorCast = getVectorCast(vectorType, dims);

    assertVectorDimensions(record.vector, dims);
    if (record.tagsVector) {
      assertVectorDimensions(record.tagsVector, dims);
    }

    const { scope, hash } = extractScopeFromContainerTag(record.containerTag);
    const metadata = parseMetadata(record.metadata) ?? {};

    const vectorLit = "'" + vectorToPgLiteral(record.vector) + "'::" + vectorCast;
    const tagsVectorLit = record.tagsVector
      ? "'" + vectorToPgLiteral(record.tagsVector) + "'::" + vectorCast
      : null;

    await sql`
      UPDATE memories SET
        scope = ${scope},
        scope_hash = ${hash},
        content = ${record.content},
        vector = ${sql.unsafe(vectorLit)},
        tags_vector = ${tagsVectorLit ? sql.unsafe(tagsVectorLit) : null},
        container_tag = ${record.containerTag},
        tags = ${record.tags ?? null},
        type = ${record.type ?? null},
        updated_at = ${record.updatedAt},
        metadata = ${sql.json(metadata as any)},        display_name = ${record.displayName ?? null},
        user_name = ${record.userName ?? null},
        user_email = ${record.userEmail ?? null},
        project_path = ${record.projectPath ?? null},
        project_name = ${record.projectName ?? null},
        git_repo_url = ${record.gitRepoUrl ?? null}
      WHERE id = ${record.id}
    `;
  }

  async getById(memoryId: string): Promise<MemoryRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM memories WHERE id = ${memoryId}
    `;
    if (rows.length === 0) return null;
    return rowToMemoryRow(rows[0]);
  }

  async search(options: MemorySearchOptions): Promise<SearchResult[]> {
    const sql = getPostgresClient();
    const dims = CONFIG.embeddingDimensions;
    const vectorType = CONFIG.postgres!.vectorType ?? "vector";
    const vectorCast = getVectorCast(vectorType, dims);
    const candidateLimit = Math.max(options.limit * 4, 50);
    const queryLiteral = vectorToPgLiteral(options.queryVector);

    const efSearch = CONFIG.postgres?.hnswEfSearch ?? 100;
    if (typeof efSearch !== "number" || efSearch < 1 || !Number.isInteger(efSearch)) {
      throw new Error(`Invalid hnswEfSearch config: ${efSearch}. Must be a positive integer.`);
    }

    let rows: any[];
    if (CONFIG.postgres?.hnswEfSearch) {
      rows = await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL hnsw.ef_search = ${efSearch}`);
        return executeSearchQuery(
          tx as unknown as SqlClient,
          options,
          queryLiteral,
          vectorCast,
          candidateLimit
        );
      });
    } else {
      rows = await executeSearchQuery(sql, options, queryLiteral, vectorCast, candidateLimit);
    }

    return computeWeightedScores(
      rows,
      options.queryText,
      options.similarityThreshold,
      options.limit
    );
  }

  async list(args: {
    scope: MemoryScopeKind;
    scopeHash: string;
    containerTag: string;
    includeAllContainers?: boolean;
    limit: number;
    userEmail?: string;
  }): Promise<MemoryRow[]> {
    const sql = getPostgresClient();
    const scopeHashFilter = args.scopeHash || "";
    const containerTagFilter = args.includeAllContainers ? "" : args.containerTag;
    const userEmailFilter = args.userEmail ?? "";

    const rows = await sql`
      SELECT * FROM memories
      WHERE scope = ${args.scope}
        AND (${scopeHashFilter}::text = '' OR scope_hash = ${scopeHashFilter})
        AND (${containerTagFilter}::text = '' OR container_tag = ${containerTagFilter})
        AND (${userEmailFilter}::text = '' OR user_email = ${userEmailFilter})
      ORDER BY created_at DESC
      LIMIT ${args.limit}
    `;

    return rows.map(rowToMemoryRow);
  }

  async getBySessionId(args: {
    sessionId: string;
    scope: MemoryScopeKind;
    scopeHash: string;
    limit: number;
  }): Promise<SearchResult[]> {
    const sql = getPostgresClient();
    const scopeHashFilter = args.scopeHash || "";

    const rows = await sql`
      SELECT * FROM memories
      WHERE session_id = ${args.sessionId}
        AND scope = ${args.scope}
        AND (${scopeHashFilter}::text = '' OR scope_hash = ${scopeHashFilter})
      ORDER BY created_at DESC
      LIMIT ${args.limit}
    `;

    return rows.map((row: any) => ({
      id: row.id,
      memory: row.content,
      similarity: 1.0,
      tags: row.tags ? row.tags.split(",").map((t: string) => t.trim()) : [],
      metadata: parseMetadata(row.metadata),
      containerTag: row.container_tag ?? undefined,
      displayName: row.display_name ?? undefined,
      userName: row.user_name ?? undefined,
      userEmail: row.user_email ?? undefined,
      projectPath: row.project_path ?? undefined,
      projectName: row.project_name ?? undefined,
      gitRepoUrl: row.git_repo_url ?? undefined,
      isPinned: row.is_pinned ?? false,
      createdAt: Number(row.created_at),
    }));
  }

  async count(args?: {
    containerTag?: string;
    scope?: MemoryScopeKind;
    scopeHash?: string;
  }): Promise<number> {
    const sql = getPostgresClient();
    const scope = args?.scope ?? "user";
    const scopeHashFilter = args?.scopeHash ?? "";
    const containerTagFilter = args?.containerTag ?? "";

    const rows = await sql`
      SELECT COUNT(*) as count FROM memories
      WHERE scope = ${scope}
        AND (${scopeHashFilter}::text = '' OR scope_hash = ${scopeHashFilter})
        AND (${containerTagFilter}::text = '' OR container_tag = ${containerTagFilter})
    `;

    return Number(rows[0]?.count ?? 0);
  }

  async countByType(): Promise<Record<string, number>> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT type, COUNT(*) as count FROM memories GROUP BY type
    `;
    const result: Record<string, number> = {};
    for (const row of rows) {
      const key = row.type ?? "(untagged)";
      result[key] = Number(row.count);
    }
    return result;
  }

  async getDistinctTags(args?: {
    scope?: MemoryScopeKind;
    scopeHash?: string;
  }): Promise<TagInfo[]> {
    const sql = getPostgresClient();
    const scope = args?.scope ?? "user";
    const scopeHashFilter = args?.scopeHash ?? "";

    const rows = await sql`
      SELECT DISTINCT container_tag, display_name, user_name, user_email,
                      project_path, project_name, git_repo_url
      FROM memories
      WHERE scope = ${scope}
        AND (${scopeHashFilter}::text = '' OR scope_hash = ${scopeHashFilter})
    `;

    return rows.map((row: any) => ({
      tag: row.container_tag,
      displayName: row.display_name ?? undefined,
      userName: row.user_name ?? undefined,
      userEmail: row.user_email ?? undefined,
      projectPath: row.project_path ?? undefined,
      projectName: row.project_name ?? undefined,
      gitRepoUrl: row.git_repo_url ?? undefined,
    }));
  }

  async pin(memoryId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`UPDATE memories SET is_pinned = true WHERE id = ${memoryId}`;
  }

  async unpin(memoryId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`UPDATE memories SET is_pinned = false WHERE id = ${memoryId}`;
  }

  async listOlderThan(cutoffTime: number, limit?: number, offset?: number): Promise<MemoryRow[]> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM memories
      WHERE updated_at < ${cutoffTime}
      ORDER BY updated_at ASC
      LIMIT ${limit ?? 1000} OFFSET ${offset ?? 0}
    `;
    return rows.map(rowToMemoryRow);
  }

  async getAllWithVectors(limit?: number, offset?: number): Promise<MemoryRecord[]> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM memories ORDER BY created_at ASC
      LIMIT ${limit ?? 1000} OFFSET ${offset ?? 0}
    `;
    return rows.map(rowToMemoryRecord);
  }

  async countUntagged(): Promise<number> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT COUNT(*) as count FROM memories
      WHERE scope = 'project' AND (tags IS NULL OR tags = '')
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async updateTagsAndVectors(
    id: string,
    tags: string,
    vector: Float32Array,
    tagsVector: Float32Array | undefined,
    updatedAt: number
  ): Promise<void> {
    const sql = getPostgresClient();
    const dims = CONFIG.embeddingDimensions;
    const vectorType = CONFIG.postgres!.vectorType ?? "vector";
    const vectorCast = getVectorCast(vectorType, dims);

    assertVectorDimensions(vector, dims);
    if (tagsVector) {
      assertVectorDimensions(tagsVector, dims);
    }
    const vectorLit = "'" + vectorToPgLiteral(vector) + "'::" + vectorCast;
    const tagsVectorLit = tagsVector
      ? "'" + vectorToPgLiteral(tagsVector) + "'::" + vectorCast
      : null;
    await sql`
      UPDATE memories SET
        tags = ${tags},
        vector = ${sql.unsafe(vectorLit)},
        tags_vector = ${tagsVectorLit ? sql.unsafe(tagsVectorLit) : null},
        updated_at = ${updatedAt}
      WHERE id = ${id}
    `;
  }
}
