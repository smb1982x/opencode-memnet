/**
 * Postgres-backed implementation of UserPromptRepository.
 *
 * Key behaviors:
 * - Atomic `claimPrompt()` with `UPDATE ... WHERE captured = 0 RETURNING id`.
 * - Tri-state `captured`: 0=uncaptured, 1=captured, 2=claimed.
 */

import { getPostgresClient, closePostgresClient } from "./client.js";
import { runPostgresMigrations } from "./migrations.js";
import type { UserPromptRepository, UserPromptRow } from "../types.js";

function rowToUserPromptRow(row: any): UserPromptRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    projectPath: row.project_path,
    content: row.content,
    createdAt: Number(row.created_at),
    captured: Number(row.captured),
    userLearningCaptured: row.user_learning_captured,
    linkedMemoryId: row.linked_memory_id,
  };
}

export class PostgresUserPromptRepository implements UserPromptRepository {
  async initialize(): Promise<void> {
    await runPostgresMigrations();
  }

  async close(): Promise<void> {
    await closePostgresClient();
  }

  async savePrompt(
    sessionId: string,
    messageId: string,
    projectPath: string,
    content: string
  ): Promise<string> {
    const sql = getPostgresClient();
    const id = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    await sql`
      INSERT INTO user_prompts (
        id, session_id, message_id, project_path,
        content, created_at, captured, user_learning_captured
      ) VALUES (
        ${id}, ${sessionId}, ${messageId}, ${projectPath},
        ${content}, ${now}, 0, false
      )
      ON CONFLICT (id) DO NOTHING
    `;

    return id;
  }

  async getLastUncapturedPrompt(sessionId: string): Promise<UserPromptRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_prompts
      WHERE session_id = ${sessionId} AND captured = 0
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToUserPromptRow(rows[0]);
  }

  async deletePrompt(promptId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`DELETE FROM user_prompts WHERE id = ${promptId}`;
  }

  async markAsCaptured(promptId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`UPDATE user_prompts SET captured = 1 WHERE id = ${promptId}`;
  }

  async claimPrompt(promptId: string): Promise<boolean> {
    const sql = getPostgresClient();
    const rows = await sql`
      UPDATE user_prompts SET captured = 2
      WHERE id = ${promptId} AND captured = 0
      RETURNING id
    `;
    return rows.length > 0;
  }

  async releasePrompt(promptId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`UPDATE user_prompts SET captured = 0 WHERE id = ${promptId} AND captured = 2`;
  }

  async countUncapturedPrompts(): Promise<number> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT COUNT(*) as count FROM user_prompts WHERE captured = 0
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async getUncapturedPrompts(limit: number): Promise<UserPromptRow[]> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_prompts
      WHERE captured = 0
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToUserPromptRow);
  }

  async markMultipleAsCaptured(promptIds: string[]): Promise<void> {
    if (promptIds.length === 0) return;
    const sql = getPostgresClient();
    await sql`
      UPDATE user_prompts SET captured = 1
      WHERE id IN ${sql(promptIds)}
    `;
  }

  async countUnanalyzedForUserLearning(): Promise<number> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT COUNT(*) as count FROM user_prompts WHERE user_learning_captured = false
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async getPromptsForUserLearning(limit: number): Promise<UserPromptRow[]> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_prompts
      WHERE user_learning_captured = false
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToUserPromptRow);
  }

  async markAsUserLearningCaptured(promptId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`
      UPDATE user_prompts SET user_learning_captured = true WHERE id = ${promptId}
    `;
  }

  async markMultipleAsUserLearningCaptured(promptIds: string[]): Promise<void> {
    if (promptIds.length === 0) return;
    const sql = getPostgresClient();
    await sql`
      UPDATE user_prompts SET user_learning_captured = true
      WHERE id IN ${sql(promptIds)}
    `;
  }

  async deleteOldPrompts(
    cutoffTime: number
  ): Promise<{ deleted: number; linkedMemoryIds: string[] }> {
    const sql = getPostgresClient();

    // Collect linked memory IDs before deleting
    const linked = await sql`
      SELECT linked_memory_id FROM user_prompts
      WHERE created_at < ${cutoffTime} AND linked_memory_id IS NOT NULL
    `;
    const linkedMemoryIds = linked
      .map((r: any) => r.linked_memory_id)
      .filter((id: string | null): id is string => id != null);

    const result = await sql`
      DELETE FROM user_prompts WHERE created_at < ${cutoffTime}
    `;

    return {
      deleted: result.count ?? 0,
      linkedMemoryIds,
    };
  }

  async linkMemoryToPrompt(promptId: string, memoryId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`
      UPDATE user_prompts SET linked_memory_id = ${memoryId} WHERE id = ${promptId}
    `;
  }

  async getPromptById(promptId: string): Promise<UserPromptRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_prompts WHERE id = ${promptId}
    `;
    if (rows.length === 0) return null;
    return rowToUserPromptRow(rows[0]);
  }

  async getCapturedPrompts(projectPath?: string): Promise<UserPromptRow[]> {
    const sql = getPostgresClient();

    let rows;
    if (projectPath) {
      rows = await sql`
        SELECT * FROM user_prompts
        WHERE captured = 1 AND project_path = ${projectPath}
        ORDER BY created_at DESC
      `;
    } else {
      rows = await sql`
        SELECT * FROM user_prompts
        WHERE captured = 1
        ORDER BY created_at DESC
      `;
    }

    return rows.map(rowToUserPromptRow);
  }

  async searchPrompts(
    query: string,
    projectPath?: string,
    limit: number = 20
  ): Promise<UserPromptRow[]> {
    const sql = getPostgresClient();
    const escaped = query.replace(/[%_]/g, "\\$&");
    const likePattern = `%${escaped}%`;

    let rows;
    if (projectPath) {
      rows = await sql`
        SELECT * FROM user_prompts
        WHERE content LIKE ${likePattern} ESCAPE '\\'
          AND captured = 1
          AND project_path = ${projectPath}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT * FROM user_prompts
        WHERE content LIKE ${likePattern} ESCAPE '\\' AND captured = 1
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    return rows.map(rowToUserPromptRow);
  }

  async getPromptsByIds(ids: string[]): Promise<UserPromptRow[]> {
    if (ids.length === 0) return [];
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_prompts WHERE id IN ${sql(ids)}
    `;
    return rows.map(rowToUserPromptRow);
  }
}
