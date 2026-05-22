/**
 * Numbered migration runner for the Postgres storage backend.
 *
 * Migrations are defined in-order as an array of `Migration` objects.
 * The runner ensures `schema_migrations` exists, discovers which versions
 * have already been applied, and executes any missing migrations.
 *
 * Transactional migrations run inside `sql.begin()`.  Non-transactional
 * migrations (e.g. index builds that need `IF NOT EXISTS` without
 * transactional restrictions) run directly.
 *
 * Vector column types are generated dynamically from
 * `CONFIG.embeddingDimensions` and `CONFIG.postgres.vectorType` so that
 * both `memories.vector` and `memories.tags_vector` always use the same
 * dimensionality.  **Never** use a different dimension for `tags_vector`.
 */

import { CONFIG } from "../../../config.js";
import { log } from "../../logger.js";
import type { SqlClient } from "./client.js";
import { getVectorCast, redactDatabaseUrl } from "./vector.js";

// ── Migration type ──

export interface Migration {
  version: number;
  description: string;
  /** `true` → wrap in `sql.begin()`; `false` → run directly. */
  transactional: boolean;
  up: (sql: SqlClient) => Promise<void>;
}

// ── Helpers ──

/**
 * Return the vector column-type string for the current configuration.
 *
 * Both `memories.vector` and `memories.tags_vector` use the same cast.
 */
function vectorColumnType(): string {
  const vectorType = CONFIG.postgres!.vectorType ?? "vector";
  const dimensions = CONFIG.embeddingDimensions;
  return getVectorCast(vectorType, dimensions);
}

// ── Migration definitions ──

export const migrations: Migration[] = [
  // ── 1: schema_migrations ──
  {
    version: 1,
    description: "Create schema_migrations table",
    transactional: true,
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version   INTEGER PRIMARY KEY,
          description TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    },
  },

  // ── 2: pgvector extension ──
  {
    version: 2,
    description: "Enable pgvector extension",
    transactional: true,
    up: async (sql) => {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    },
  },

  // ── 3: embedding_config ──
  {
    version: 3,
    description: "Create embedding_config table",
    transactional: true,
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS embedding_config (
          id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          model_name  TEXT    NOT NULL,
          dimensions  INTEGER NOT NULL,
          vector_type TEXT    NOT NULL CHECK (vector_type IN ('vector', 'halfvec')),
          is_active   BOOLEAN NOT NULL DEFAULT TRUE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_config_active
        ON embedding_config (is_active)
        WHERE is_active = TRUE
      `;
    },
  },

  // ── 4: memories table ──
  {
    version: 4,
    description: "Create memories table with dynamic vector columns",
    transactional: true,
    up: async (sql) => {
      const vecType = vectorColumnType();
      // Dynamic DDL: validated vector type + integer dimensions from config.
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS memories (
          id            TEXT PRIMARY KEY,

          scope         TEXT    NOT NULL CHECK (scope IN ('user', 'project')),
          scope_hash    TEXT    NOT NULL,
          shard_index   INTEGER,

          content       TEXT    NOT NULL,
          vector        ${vecType} NOT NULL,
          tags_vector   ${vecType},

          container_tag TEXT    NOT NULL,
          tags          TEXT,
          type          TEXT,

          created_at    BIGINT  NOT NULL,
          updated_at    BIGINT  NOT NULL,

          metadata      JSONB   NOT NULL DEFAULT '{}'::jsonb,
          session_id    TEXT    GENERATED ALWAYS AS (
            COALESCE(
              metadata->>'sessionID',
              metadata->>'sessionId',
              metadata->>'session_id'
            )
          ) STORED,

          display_name   TEXT,
          user_name      TEXT,
          user_email     TEXT,
          project_path   TEXT,
          project_name   TEXT,
          git_repo_url   TEXT,
          is_pinned      BOOLEAN NOT NULL DEFAULT FALSE,

          migrated_from_db_path TEXT,
          migrated_at          TIMESTAMPTZ
        )
      `);
    },
  },

  // ── 5: memories standard indexes ──
  {
    version: 5,
    description: "Create memories standard indexes",
    transactional: true,
    up: async (sql) => {
      await sql`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories (scope, scope_hash)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_memories_container_tag ON memories (container_tag)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories (type)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_memories_is_pinned ON memories (is_pinned)`;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_memories_session_id
        ON memories (session_id)
        WHERE session_id IS NOT NULL
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_memories_metadata_gin ON memories USING GIN (metadata)`;
    },
  },

  // ── 6: HNSW vector indexes ──
  {
    version: 6,
    description: "Create memories HNSW vector indexes",
    transactional: false,
    up: async (sql) => {
      const vectorType = CONFIG.postgres!.vectorType ?? "vector";
      const opClass = vectorType === "halfvec" ? "halfvec_cosine_ops" : "vector_cosine_ops";
      const efConstruction = CONFIG.postgres!.hnswEfConstruction ?? 256;

      // Use CREATE INDEX IF NOT EXISTS (no CONCURRENTLY) so it is safe
      // inside or outside a transaction and idempotent.
      await sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_memories_vector_hnsw
        ON memories USING hnsw (vector ${opClass})
        WITH (m = 16, ef_construction = ${efConstruction})
      `);

      await sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_memories_tags_vector_hnsw
        ON memories USING hnsw (tags_vector ${opClass})
        WITH (m = 16, ef_construction = ${efConstruction})
        WHERE tags_vector IS NOT NULL
      `);
    },
  },

  // ── 7: user_prompts ──
  {
    version: 7,
    description: "Create user_prompts table and indexes",
    transactional: true,
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_prompts (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT    NOT NULL,
          message_id            TEXT    NOT NULL,
          project_path          TEXT,
          content               TEXT    NOT NULL,
          created_at            BIGINT  NOT NULL,
          captured              SMALLINT NOT NULL DEFAULT 0,
          user_learning_captured BOOLEAN NOT NULL DEFAULT FALSE,
          linked_memory_id      TEXT REFERENCES memories(id) ON DELETE SET NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_user_prompts_session ON user_prompts (session_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_user_prompts_captured ON user_prompts (captured)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_user_prompts_created ON user_prompts (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_user_prompts_project ON user_prompts (project_path)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_user_prompts_linked ON user_prompts (linked_memory_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_user_prompts_user_learning ON user_prompts (user_learning_captured)`;
    },
  },

  // ── 8: user_profiles + changelogs ──
  {
    version: 8,
    description: "Create user_profiles and user_profile_changelogs tables",
    transactional: true,
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_profiles (
          id                      TEXT PRIMARY KEY,
          user_id                 TEXT    NOT NULL UNIQUE,
          display_name            TEXT    NOT NULL,
          user_name               TEXT    NOT NULL,
          user_email              TEXT    NOT NULL,
          profile_data            JSONB   NOT NULL,
          version                 INTEGER NOT NULL DEFAULT 1,
          created_at              BIGINT  NOT NULL,
          last_analyzed_at        BIGINT  NOT NULL,
          total_prompts_analyzed  INTEGER NOT NULL DEFAULT 0,
          is_active               BOOLEAN NOT NULL DEFAULT TRUE
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS user_profile_changelogs (
          id                      TEXT PRIMARY KEY,
          profile_id              TEXT    NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
          version                 INTEGER NOT NULL,
          change_type             TEXT    NOT NULL,
          change_summary          TEXT    NOT NULL,
          profile_data_snapshot   JSONB   NOT NULL,
          created_at              BIGINT  NOT NULL
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles (user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active ON user_profiles (is_active)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_user_profile_changelogs_profile_id ON user_profile_changelogs (profile_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_user_profile_changelogs_version ON user_profile_changelogs (version DESC)`;
    },
  },

  // ── 9: ai_sessions + ai_messages ──
  {
    version: 9,
    description: "Create ai_sessions and ai_messages tables",
    transactional: true,
    up: async (sql) => {
      await sql`
        CREATE TABLE IF NOT EXISTS ai_sessions (
          id              TEXT PRIMARY KEY,
          provider        TEXT    NOT NULL,
          session_id      TEXT    NOT NULL,
          conversation_id TEXT,
          metadata        JSONB,
          created_at      BIGINT  NOT NULL,
          updated_at      BIGINT  NOT NULL,
          expires_at      BIGINT  NOT NULL
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ai_messages (
          id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          ai_session_id   TEXT    NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
          sequence        INTEGER NOT NULL,
          role            TEXT    NOT NULL,
          content         TEXT    NOT NULL,
          tool_calls      JSONB,
          tool_call_id    TEXT,
          content_blocks  JSONB,
          created_at      BIGINT  NOT NULL,
          UNIQUE (ai_session_id, sequence)
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_ai_sessions_session_id ON ai_sessions (session_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_ai_sessions_expires_at ON ai_sessions (expires_at)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_ai_sessions_provider ON ai_sessions (provider)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages (ai_session_id, sequence)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_ai_messages_role ON ai_messages (ai_session_id, role)`;
    },
  },

  // ── 10: active embedding config row ──
  {
    version: 10,
    description: "Set active embedding config",
    transactional: true,
    up: async (sql) => {
      const modelName = CONFIG.embeddingModel ?? "text-embedding";
      const dimensions = CONFIG.embeddingDimensions;
      const vectorType = CONFIG.postgres!.vectorType ?? "vector";

      // Transactional activate: deactivate old, insert new. The migration runner
      // supplies either a transaction client or the base client as appropriate.
      await sql`UPDATE embedding_config SET is_active = FALSE WHERE is_active = TRUE`;
      await sql`
        INSERT INTO embedding_config (model_name, dimensions, vector_type, is_active)
        VALUES (${modelName}, ${dimensions}, ${vectorType}, TRUE)
      `;
    },
  },

  // ── 11: unique constraint on ai_sessions(session_id, provider) ──
  {
    version: 11,
    description: "Add unique index on ai_sessions (session_id, provider)",
    transactional: true,
    up: async (sql) => {
      // First deduplicate: keep the most recent row per (session_id, provider).
      await sql`
        DELETE FROM ai_sessions a
        USING ai_sessions b
        WHERE a.session_id = b.session_id
          AND a.provider = b.provider
          AND a.id < b.id
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_sessions_session_provider
        ON ai_sessions (session_id, provider)
      `;
    },
  },
];

// ── Runner ──

/**
 * Ensure the `schema_migrations` table exists (idempotent) and return the
 * set of already-applied migration versions.
 */
async function getAppliedVersions(sql: SqlClient): Promise<Set<number>> {
  // Ensure the table exists even if migration #1 has not run yet.
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  const rows = await sql`SELECT version FROM schema_migrations ORDER BY version`;
  return new Set(rows.map((r: any) => r.version as number));
}

/**
 * Promise-based lock ensuring migrations execute at most once per process.
 * If `runPostgresMigrations` is called concurrently, all callers await the
 * same promise instead of starting duplicate migration runs.
 */
let migrationsPromise: Promise<void> | null = null;

/**
 * Run all pending Postgres migrations.
 *
 * Accepts an optional `sql` parameter so tests can pass a controlled client.
 * If omitted, the default singleton client is used via `getPostgresClient()`.
 *
 * Uses a promise-based lock so that concurrent callers never execute
 * migrations more than once — they all await the same in-flight promise.
 */
export function runPostgresMigrations(sql?: SqlClient): Promise<void> {
  if (migrationsPromise) return migrationsPromise;
  migrationsPromise = runMigrationsInternal(sql);
  return migrationsPromise;
}

/**
 * Internal migration runner — always invoked through `runPostgresMigrations`.
 */
async function runMigrationsInternal(sql?: SqlClient): Promise<void> {
  // Lazy import to avoid instantiation until actually needed.
  const { getPostgresClient } = await import("./client.js");
  const client = sql ?? getPostgresClient();

  const applied = await getAppliedVersions(client);

  const pending = migrations.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    log("[postgres/migrate] All migrations already applied");
    return;
  }

  log("[postgres/migrate] Running pending migrations", {
    count: pending.length,
    versions: pending.map((m) => m.version),
    url: redactDatabaseUrl(CONFIG.postgres!.url ?? ""),
  });

  for (const migration of pending) {
    const label = `v${migration.version}: ${migration.description}`;
    try {
      if (migration.transactional) {
        await client.begin(async (tx) => {
          await migration.up(tx as unknown as SqlClient);
          await tx`
            INSERT INTO schema_migrations (version, description)
            VALUES (${migration.version}, ${migration.description})
          `;
        });
      } else {
        // Non-transactional: run directly, then record.
        await migration.up(client);
        await client`
          INSERT INTO schema_migrations (version, description)
          VALUES (${migration.version}, ${migration.description})
        `;
      }
      log(`[postgres/migrate] Applied ${label}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[postgres/migrate] FAILED ${label}`, { error: message });
      throw new Error(`Migration ${label} failed: ${message}`);
    }
  }

  log("[postgres/migrate] All pending migrations applied successfully");
}
