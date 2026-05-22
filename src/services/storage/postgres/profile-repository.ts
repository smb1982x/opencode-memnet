/**
 * Postgres-backed implementation of UserProfileRepository.
 *
 * Uses JSONB for profile_data and profile_data_snapshot columns.
 * Implements mergeProfileData behavior equivalent to the SQLite UserProfileManager.
 */

import { getPostgresClient, closePostgresClient } from "./client.js";
import { runPostgresMigrations } from "./migrations.js";
import { mergeProfileData } from "./profile-utils.js";
import { CONFIG } from "../../../config.js";
import type {
  UserProfileRepository,
  UserProfileRow,
  UserProfileChangelogRow,
  UserProfileData,
} from "../types.js";

// ── Helpers ──

function ensureArray(val: unknown): any[] {
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
}

function rowToProfileRow(row: any): UserProfileRow {
  // profile_data is JSONB, so row.profile_data is already an object
  const profileData =
    typeof row.profile_data === "string"
      ? row.profile_data
      : JSON.stringify(row.profile_data ?? { preferences: [], patterns: [], workflows: [] });

  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    userName: row.user_name,
    userEmail: row.user_email,
    profileData,
    version: row.version,
    createdAt: Number(row.created_at),
    lastAnalyzedAt: Number(row.last_analyzed_at),
    totalPromptsAnalyzed: row.total_prompts_analyzed,
    isActive: row.is_active,
  };
}

function rowToChangelogRow(row: any): UserProfileChangelogRow {
  const snapshot =
    typeof row.profile_data_snapshot === "string"
      ? row.profile_data_snapshot
      : JSON.stringify(
          row.profile_data_snapshot ?? { preferences: [], patterns: [], workflows: [] }
        );

  return {
    id: row.id,
    profileId: row.profile_id,
    version: row.version,
    changeType: row.change_type,
    changeSummary: row.change_summary,
    profileDataSnapshot: snapshot,
    createdAt: Number(row.created_at),
  };
}

// ── Repository ──

export class PostgresUserProfileRepository implements UserProfileRepository {
  async initialize(): Promise<void> {
    await runPostgresMigrations();
  }

  async close(): Promise<void> {
    await closePostgresClient();
  }

  async getActiveProfile(userId: string): Promise<UserProfileRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_profiles
      WHERE user_id = ${userId} AND is_active = true
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToProfileRow(rows[0]);
  }

  async getProfileById(profileId: string): Promise<UserProfileRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_profiles WHERE id = ${profileId}
    `;
    if (rows.length === 0) return null;
    return rowToProfileRow(rows[0]);
  }

  async getAllActiveProfiles(): Promise<UserProfileRow[]> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_profiles WHERE is_active = true
    `;
    return rows.map(rowToProfileRow);
  }

  async createProfile(
    userId: string,
    displayName: string,
    userName: string,
    userEmail: string,
    profileData: UserProfileData,
    promptsAnalyzed: number
  ): Promise<string> {
    const sql = getPostgresClient();
    const id = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const cleanedData: UserProfileData = {
      preferences: ensureArray(profileData.preferences),
      patterns: ensureArray(profileData.patterns),
      workflows: ensureArray(profileData.workflows),
    };

    await sql`
      INSERT INTO user_profiles (
        id, user_id, display_name, user_name, user_email,
        profile_data, version, created_at, last_analyzed_at,
        total_prompts_analyzed, is_active
      ) VALUES (
        ${id}, ${userId}, ${displayName}, ${userName}, ${userEmail},
        ${sql.json(cleanedData as any)}, 1, ${now}, ${now},
        ${promptsAnalyzed}, true
      )
      ON CONFLICT (id) DO NOTHING
    `;

    // Add creation changelog
    await this.addChangelog(sql, id, 1, "create", "Initial profile creation", cleanedData);

    return id;
  }

  async updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string
  ): Promise<void> {
    const sql = getPostgresClient();
    const now = Date.now();

    const cleanedData: UserProfileData = {
      preferences: ensureArray(profileData.preferences),
      patterns: ensureArray(profileData.patterns),
      workflows: ensureArray(profileData.workflows),
    };

    // Atomic version increment — avoids read-modify-write race.
    const result = await sql`
      UPDATE user_profiles SET
        profile_data = ${sql.json(cleanedData as any)},
        version = version + 1,
        last_analyzed_at = ${now},
        total_prompts_analyzed = total_prompts_analyzed + ${additionalPromptsAnalyzed}
      WHERE id = ${profileId}
      RETURNING version
    `;
    const newVersion = Number(result[0]?.version ?? 0);

    await this.addChangelog(sql, profileId, newVersion, "update", changeSummary, cleanedData);
    await this.cleanupOldChangelogs(sql, profileId);
  }

  async deleteProfile(profileId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`DELETE FROM user_profiles WHERE id = ${profileId}`;
  }

  async applyConfidenceDecay(profileId: string): Promise<void> {
    const sql = getPostgresClient();
    const now = Date.now();
    const decayThresholdMs = CONFIG.userProfileConfidenceDecayDays * 24 * 60 * 60 * 1000;
    const CHANGE_THRESHOLD = 0.05;
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Read current profile data + version for optimistic locking (#9)
      const rows = await sql`
        SELECT profile_data, version FROM user_profiles WHERE id = ${profileId}
      `;
      if (rows.length === 0) return;

      const profileData: UserProfileData =
        typeof rows[0]!.profile_data === "string"
          ? JSON.parse(rows[0]!.profile_data)
          : (rows[0]!.profile_data as UserProfileData);

      const expectedVersion = Number(rows[0]!.version);
      const originalPrefCount = profileData.preferences.length;

      let hasSignificantChange = false;

      profileData.preferences = profileData.preferences
        .map((pref) => {
          const age = now - pref.lastUpdated;
          if (age > decayThresholdMs) {
            const decayFactor = Math.max(0.5, 1 - (age - decayThresholdMs) / decayThresholdMs);
            const newConfidence = pref.confidence * decayFactor;
            if (pref.confidence - newConfidence > CHANGE_THRESHOLD) {
              hasSignificantChange = true;
            }
            return { ...pref, confidence: newConfidence };
          }
          return pref;
        })
        .filter((pref) => pref.confidence >= 0.3);

      // #19: Always write back when prefs are filtered out, even if no single
      // preference crossed the CHANGE_THRESHOLD. Without this the filtered prefs
      // are silently lost and reappear on the next cycle.
      const prefsWereRemoved = profileData.preferences.length < originalPrefCount;
      if (!hasSignificantChange && !prefsWereRemoved) return;

      const cleanedData: UserProfileData = {
        preferences: ensureArray(profileData.preferences),
        patterns: ensureArray(profileData.patterns),
        workflows: ensureArray(profileData.workflows),
      };

      // #9: Optimistic lock — only UPDATE if version matches what we read.
      // A concurrent write will bump version, causing 0 rows returned → retry.
      const result = await sql`
        UPDATE user_profiles
        SET profile_data = ${sql.json(cleanedData as any)},
            version = version + 1,
            last_analyzed_at = ${now}
        WHERE id = ${profileId} AND version = ${expectedVersion}
        RETURNING version
      `;

      if (result.length === 0) {
        // Concurrent modification — retry with fresh data
        continue;
      }

      const newVersion = Number(result[0]!.version);
      await this.addChangelog(
        sql,
        profileId,
        newVersion,
        "decay",
        "Applied confidence decay to preferences",
        cleanedData
      );
      await this.cleanupOldChangelogs(sql, profileId);
      return;
    }
    // Retries exhausted — concurrent contention; safe to skip, next decay cycle will retry
  }

  async getProfileChangelogs(
    profileId: string,
    limit: number = 10
  ): Promise<UserProfileChangelogRow[]> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_profile_changelogs
      WHERE profile_id = ${profileId}
      ORDER BY version DESC
      LIMIT ${limit}
    `;
    return rows.map(rowToChangelogRow);
  }

  async getChangelogById(changelogId: string): Promise<UserProfileChangelogRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_profile_changelogs
      WHERE id = ${changelogId}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToChangelogRow(rows[0]);
  }

  mergeProfileData(existing: UserProfileData, updates: Partial<UserProfileData>): UserProfileData {
    return mergeProfileData(existing, updates, {
      maxPreferences: CONFIG.userProfileMaxPreferences,
      maxPatterns: CONFIG.userProfileMaxPatterns,
      maxWorkflows: CONFIG.userProfileMaxWorkflows,
    });
  }

  // ── Private helpers ──

  private async addChangelog(
    sql: any,
    profileId: string,
    version: number,
    changeType: string,
    changeSummary: string,
    profileData: UserProfileData
  ): Promise<void> {
    const id = `changelog_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    await sql`
      INSERT INTO user_profile_changelogs (
        id, profile_id, version, change_type, change_summary,
        profile_data_snapshot, created_at
      ) VALUES (
        ${id}, ${profileId}, ${version}, ${changeType}, ${changeSummary},
        ${sql.json(profileData as any)}, ${now}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  private async cleanupOldChangelogs(sql: any, profileId: string): Promise<void> {
    const retentionCount = CONFIG.userProfileChangelogRetentionCount;

    await sql`
      DELETE FROM user_profile_changelogs
      WHERE profile_id = ${profileId}
        AND id NOT IN (
          SELECT id FROM user_profile_changelogs
          WHERE profile_id = ${profileId}
          ORDER BY version DESC
          LIMIT ${retentionCount}
        )
    `;
  }
}
