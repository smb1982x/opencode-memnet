/**
 * Postgres-backed implementation of AISessionRepository.
 *
 * Uses JSONB for metadata, tool_calls, and content_blocks columns.
 * Respects the UNIQUE (ai_session_id, sequence) constraint on ai_messages.
 */

import { getPostgresClient, closePostgresClient } from "./client.js";
import { runPostgresMigrations } from "./migrations.js";
import { CONFIG } from "../../../config.js";
import type { AISessionRepository, AISessionRow, AIMessageRow } from "../types.js";

function rowToSessionRow(row: any): AISessionRow {
  return {
    id: row.id,
    provider: row.provider,
    sessionId: row.session_id,
    conversationId: row.conversation_id ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    expiresAt: Number(row.expires_at),
  };
}

function rowToMessageRow(row: any): AIMessageRow {
  return {
    id: row.id,
    aiSessionId: row.ai_session_id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    contentBlocks: row.content_blocks ?? undefined,
    createdAt: Number(row.created_at),
  };
}

export class PostgresAISessionRepository implements AISessionRepository {
  async initialize(): Promise<void> {
    await runPostgresMigrations();
  }

  async close(): Promise<void> {
    await closePostgresClient();
  }

  async getSession(sessionId: string, provider: string): Promise<AISessionRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM ai_sessions
      WHERE session_id = ${sessionId} AND provider = ${provider} AND expires_at > ${Date.now()}
    `;
    if (rows.length === 0) return null;
    return rowToSessionRow(rows[0]);
  }

  async createSession(params: {
    provider: string;
    sessionId: string;
    conversationId?: string;
    metadata?: Record<string, any>;
  }): Promise<AISessionRow> {
    const sql = getPostgresClient();
    const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    const retentionMs = CONFIG.aiSessionRetentionDays * 24 * 60 * 60 * 1000;
    const expiresAt = now + retentionMs;

    const rows = await sql`
      INSERT INTO ai_sessions (
        id, provider, session_id, conversation_id,
        metadata, created_at, updated_at, expires_at
      ) VALUES (
        ${id}, ${params.provider}, ${params.sessionId},
        ${params.conversationId ?? null},
        ${params.metadata ? sql.json(params.metadata) : null},
        ${now}, ${now}, ${expiresAt}
      )
      ON CONFLICT (session_id, provider) DO UPDATE SET
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at,
        conversation_id = COALESCE(EXCLUDED.conversation_id, ai_sessions.conversation_id),
        metadata = COALESCE(EXCLUDED.metadata, ai_sessions.metadata)
      RETURNING *
    `;

    const row = rows[0];
    return rowToSessionRow(row);
  }

  async updateSession(
    sessionId: string,
    provider: string,
    updates: { conversationId?: string; metadata?: Record<string, any> }
  ): Promise<void> {
    const sql = getPostgresClient();
    const now = Date.now();

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.conversationId !== undefined) {
      setClauses.push(`conversation_id = $${values.length + 1}`);
      values.push(updates.conversationId);
    }

    if (updates.metadata !== undefined) {
      // Can't use sql.jsonb in unsafe queries; serialize manually
      setClauses.push(`metadata = $${values.length + 1}::jsonb`);
      values.push(JSON.stringify(updates.metadata));
    }

    setClauses.push(`updated_at = $${values.length + 1}`);
    values.push(now);

    values.push(sessionId);
    values.push(provider);

    await sql.unsafe(
      `UPDATE ai_sessions SET ${setClauses.join(", ")} WHERE session_id = $${values.length - 1} AND provider = $${values.length}`,
      values
    );
  }

  async deleteSession(sessionId: string, provider: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`
      DELETE FROM ai_sessions WHERE session_id = ${sessionId} AND provider = ${provider}
    `;
  }

  async cleanupExpiredSessions(): Promise<number> {
    const sql = getPostgresClient();
    const result = await sql`
      DELETE FROM ai_sessions WHERE expires_at < ${Date.now()}
    `;
    return result.count ?? 0;
  }

  async addMessage(message: Omit<AIMessageRow, "id" | "createdAt">): Promise<void> {
    const sql = getPostgresClient();
    const now = Date.now();

    await sql`
      INSERT INTO ai_messages (
        ai_session_id, sequence, role, content,
        tool_calls, tool_call_id, content_blocks, created_at
      ) VALUES (
        ${message.aiSessionId},
        ${message.sequence},
        ${message.role},
        ${message.content},
        ${message.toolCalls ? sql.json(message.toolCalls) : null},
        ${message.toolCallId ?? null},
        ${message.contentBlocks ? sql.json(message.contentBlocks) : null},
        ${now}
      )
    `;
  }

  async getMessages(aiSessionId: string): Promise<AIMessageRow[]> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM ai_messages
      WHERE ai_session_id = ${aiSessionId}
      ORDER BY sequence ASC
    `;
    return rows.map(rowToMessageRow);
  }

  async getLastSequence(aiSessionId: string): Promise<number> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT MAX(sequence) as max_seq FROM ai_messages WHERE ai_session_id = ${aiSessionId}
    `;
    const maxSeq = rows[0]?.max_seq;
    return maxSeq != null ? Number(maxSeq) : -1;
  }

  async clearMessages(aiSessionId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`DELETE FROM ai_messages WHERE ai_session_id = ${aiSessionId}`;
  }
}
