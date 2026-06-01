// tag-registry.ts — PostgreSQL-backed canonical tag registry
// Manages canonical tags, aliases, normalization, and memory-tag links.
// Enforces tag quality by normalizing raw tag inputs into canonical forms.

import { getPostgresClient } from "./client.js";
import { log } from "../../logger.js";
import type { SqlClient } from "./client.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface CanonicalTag {
  id: number;
  canonicalName: string;
  description: string | null;
  category: string | null;
  orderSensitive: boolean;
  usageCount: number;
  lastUsedAt: string | null;
}

export interface TagAlias {
  id: number;
  tagId: number;
  alias: string;
  normalizedAlias: string;
}

export interface TagWithAliases extends CanonicalTag {
  aliases: TagAlias[];
}

// ── Order-sensitive technical phrases ────────────────────────────────────
// These compound tags must NOT be alphabetically reordered.
// Two-term sorted canonicalization is skipped for these.

const ORDER_SENSITIVE_PHRASES = new Set([
  "blue-green-deployment",
  "api-key-authentication",
  "ci-cd",
  "rate-limiting",
  "circuit-breaker",
  "connection-pooling",
  "pdf-generation",
  "database-concurrency",
  "configuration-management",
  "concurrency-control",
  "job-queue",
  "job-runner",
  "container-orchestration",
  "load-balancer",
  "service-mesh",
  "api-gateway",
  "event-sourcing",
  "message-queue",
  "pub-sub",
  "request-response",
  "client-server",
  "producer-consumer",
  "reader-writer",
  "master-slave",
  "primary-replica",
  "leader-follower",
  "push-pull",
  "fan-out",
  "fan-in",
  "scatter-gather",
  "map-reduce",
  "divide-conquer",
]);

// ── Normalization ───────────────────────────────────────────────────────

/**
 * Normalize a raw tag name for comparison and storage.
 * - Lowercase
 * - Trim whitespace
 * - Normalize separators (spaces, underscores, multiple hyphens → single hyphen)
 * - Remove common verb suffixes (-ing, -ed, -ate, -ates)
 */
export function normalizeTagName(raw: string): string {
  let name = raw.toLowerCase().trim();
  // Normalize separators
  name = name.replace(/[\s_]+/g, "-");
  name = name.replace(/-+/g, "-");
  name = name.replace(/^-|-$/g, "");
  return name;
}

/**
 * Canonicalize a tag name by sorting terms for two-term reversible relationship tags.
 * Returns the canonical form. Order-sensitive phrases are NOT reordered.
 */
export function canonicalizeTagName(normalizedName: string): string {
  if (ORDER_SENSITIVE_PHRASES.has(normalizedName)) {
    return normalizedName;
  }

  const parts = normalizedName.split("-");

  // Only apply sorted-term canonicalization to exactly two terms
  // where both terms are "peer" concepts (neither is a modifier)
  if (parts.length === 2) {
    const [a, b] = parts;
    // Sort alphabetically for deterministic canonical form
    if (a! > b!) {
      return `${b!}-${a!}`;
    }
  }

  return normalizedName;
}

// ── Tag Registry Service ────────────────────────────────────────────────

export class PostgresTagRegistry {
  /**
   * Initialize the tag registry. Currently a no-op since migrations
   * are handled by the migration runner.
   */
  async initialize(): Promise<void> {
    log("[tag-registry] Initialized");
  }

  /**
   * Get the SQL client (lazy singleton pool).
   */
  private sql(): SqlClient {
    return getPostgresClient();
  }

  /**
   * Resolve a raw tag name to a canonical tag ID.
   * 1. Normalize the name
   * 2. Check canonical tags directly
   * 3. Check aliases
   * 4. Check sorted-term canonical form
   * 5. If not found, create a new canonical tag
   *
   * Returns { tagId, canonicalName, isNew }
   */
  async resolveOrCreateTag(rawTag: string): Promise<{
    tagId: number;
    canonicalName: string;
    isNew: boolean;
  }> {
    const sql = this.sql();
    const normalized = normalizeTagName(rawTag);
    if (!normalized) {
      throw new Error(`Tag normalized to empty string: "${rawTag}"`);
    }

    // 1. Direct lookup by canonical name
    const direct = await sql`
      SELECT id, canonical_name FROM memory_tags
      WHERE canonical_name = ${normalized}
    `;
    if (direct.length > 0) {
      const row = direct[0]!;
      return {
        tagId: row.id,
        canonicalName: row.canonical_name,
        isNew: false,
      };
    }

    // 2. Lookup by alias
    const aliasMatch = await sql`
      SELECT mt.id, mt.canonical_name
      FROM memory_tag_aliases mta
      JOIN memory_tags mt ON mt.id = mta.tag_id
      WHERE mta.normalized_alias = ${normalized}
    `;
    if (aliasMatch.length > 0) {
      const row = aliasMatch[0]!;
      return {
        tagId: row.id,
        canonicalName: row.canonical_name,
        isNew: false,
      };
    }

    // 3. Check sorted-term canonical form
    const canonical = canonicalizeTagName(normalized);
    if (canonical !== normalized) {
      const canonMatch = await sql`
        SELECT id, canonical_name FROM memory_tags
        WHERE canonical_name = ${canonical}
      `;
      if (canonMatch.length > 0) {
        // Add the normalized form as an alias
        const cmr = canonMatch[0]!;
        await this.addAlias(cmr.id, normalized);
        return {
          tagId: cmr.id,
          canonicalName: cmr.canonical_name,
          isNew: false,
        };
      }

      // Also check aliases for the canonical form
      const canonAlias = await sql`
        SELECT mt.id, mt.canonical_name
        FROM memory_tag_aliases mta
        JOIN memory_tags mt ON mt.id = mta.tag_id
        WHERE mta.normalized_alias = ${canonical}
      `;
      if (canonAlias.length > 0) {
        const car = canonAlias[0]!;
        await this.addAlias(car.id, normalized);
        return {
          tagId: car.id,
          canonicalName: car.canonical_name,
          isNew: false,
        };
      }
    }

    // 4. Create a new canonical tag
    const finalName = canonical;
    const inserted = await sql`
      INSERT INTO memory_tags (canonical_name)
      VALUES (${finalName})
      ON CONFLICT (canonical_name) DO UPDATE SET usage_count = memory_tags.usage_count
      RETURNING id, canonical_name
    `;
    const insertedRow = inserted[0]!;
    const tagId = insertedRow.id;
    const createdName = insertedRow.canonical_name;

    // If the raw tag differs from the canonical name, add as alias
    if (normalized !== finalName) {
      await this.addAlias(tagId, normalized);
    }

    // If the original raw input differs from the normalized form, add as alias
    const rawLowered = rawTag.toLowerCase().trim();
    if (rawLowered !== normalized && rawLowered !== finalName) {
      await this.addAlias(tagId, rawLowered);
    }

    log(`[tag-registry] Created canonical tag: "${createdName}" (id=${tagId})`);

    return {
      tagId,
      canonicalName: createdName,
      isNew: true,
    };
  }

  /**
   * Resolve a raw tag to a canonical tag ID without creating.
   * Returns null if no match found.
   */
  async resolveTag(rawTag: string): Promise<number | null> {
    const sql = this.sql();
    const normalized = normalizeTagName(rawTag);
    if (!normalized) return null;

    // Direct lookup
    const direct = await sql`
      SELECT id FROM memory_tags WHERE canonical_name = ${normalized}
    `;
    if (direct.length > 0) return direct[0]!.id;

    // Alias lookup
    const alias = await sql`
      SELECT tag_id FROM memory_tag_aliases WHERE normalized_alias = ${normalized}
    `;
    if (alias.length > 0) return alias[0]!.tag_id;

    // Canonical form lookup
    const canonical = canonicalizeTagName(normalized);
    if (canonical !== normalized) {
      const canon = await sql`
        SELECT id FROM memory_tags WHERE canonical_name = ${canonical}
      `;
      if (canon.length > 0) return canon[0]!.id;

      const canonAlias = await sql`
        SELECT tag_id FROM memory_tag_aliases WHERE normalized_alias = ${canonical}
      `;
      if (canonAlias.length > 0) return canonAlias[0]!.tag_id;
    }

    return null;
  }

  /**
   * Add an alias for a canonical tag.
   * Silently ignores if alias already exists for a different tag.
   */
  async addAlias(tagId: number, alias: string): Promise<void> {
    const sql = this.sql();
    const normalizedAlias = normalizeTagName(alias);
    if (!normalizedAlias) return;

    try {
      await sql`
        INSERT INTO memory_tag_aliases (tag_id, alias, normalized_alias)
        VALUES (${tagId}, ${alias}, ${normalizedAlias})
        ON CONFLICT (normalized_alias) DO NOTHING
      `;
    } catch {
      // Alias might belong to another tag — ignore
    }
  }

  /**
   * Link a memory to tags by raw tag names.
   * Resolves each raw tag to a canonical tag (creating if needed),
   * then upserts the memory-tag links.
   * Also increments usage_count on each canonical tag.
   */
  async linkMemoryTags(memoryId: string, rawTags: string[]): Promise<void> {
    if (!rawTags || rawTags.length === 0) return;
    const sql = this.sql();

    // Resolve all tags
    const tagIds: number[] = [];
    for (const raw of rawTags) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const { tagId } = await this.resolveOrCreateTag(trimmed);
      tagIds.push(tagId);
    }

    // Remove duplicates
    const uniqueTagIds = [...new Set(tagIds)];

    // Upsert links
    for (const tagId of uniqueTagIds) {
      await sql`
        INSERT INTO memory_tag_links (memory_id, tag_id)
        VALUES (${memoryId}, ${tagId})
        ON CONFLICT (memory_id, tag_id) DO NOTHING
      `;
      // Update usage count
      await sql`
        UPDATE memory_tags
        SET usage_count = usage_count + 1,
            last_used_at = NOW(),
            updated_at = NOW()
        WHERE id = ${tagId}
      `;
    }
  }

  /**
   * Remove all tag links for a memory.
   */
  async unlinkMemoryTags(memoryId: string): Promise<void> {
    const sql = this.sql();
    await sql`
      DELETE FROM memory_tag_links WHERE memory_id = ${memoryId}
    `;
  }

  /**
   * Get all canonical tags ordered by usage count.
   */
  async getAllCanonicalTags(limit = 500): Promise<CanonicalTag[]> {
    const sql = this.sql();
    const rows = await sql`
      SELECT id, canonical_name, description, category, order_sensitive,
             usage_count, last_used_at
      FROM memory_tags
      ORDER BY usage_count DESC, canonical_name ASC
      LIMIT ${limit}
    `;
    return rows.map((r: any) => ({
      id: r.id,
      canonicalName: r.canonical_name,
      description: r.description,
      category: r.category,
      orderSensitive: r.order_sensitive,
      usageCount: r.usage_count,
      lastUsedAt: r.last_used_at,
    }));
  }

  /**
   * Get canonical tag names for use in LLM prompts.
   * Returns up to `limit` most-used tag names.
   */
  async getCanonicalTagNames(limit = 50): Promise<string[]> {
    const tags = await this.getAllCanonicalTags(limit);
    return tags.map((t) => t.canonicalName);
  }

  /**
   * Get tags linked to a specific memory.
   */
  async getMemoryTagNames(memoryId: string): Promise<string[]> {
    const sql = this.sql();
    const rows = await sql`
      SELECT mt.canonical_name
      FROM memory_tag_links mtl
      JOIN memory_tags mt ON mt.id = mtl.tag_id
      WHERE mtl.memory_id = ${memoryId}
      ORDER BY mt.canonical_name
    `;
    return rows.map((r: any) => r.canonical_name);
  }

  /**
   * Get memories that share tags with a given memory.
   * Returns memory IDs ranked by number of shared tags.
   */
  async getRelatedMemoryIds(
    memoryId: string,
    limit = 20
  ): Promise<Array<{ memoryId: string; sharedTagCount: number }>> {
    const sql = this.sql();
    const rows = await sql`
      SELECT mtl2.memory_id, COUNT(*) as shared_count
      FROM memory_tag_links mtl1
      JOIN memory_tag_links mtl2 ON mtl1.tag_id = mtl2.tag_id
      WHERE mtl1.memory_id = ${memoryId}
        AND mtl2.memory_id != ${memoryId}
      GROUP BY mtl2.memory_id
      ORDER BY shared_count DESC
      LIMIT ${limit}
    `;
    return rows.map((r: any) => ({
      memoryId: r.memory_id,
      sharedTagCount: Number(r.shared_count),
    }));
  }

  /**
   * Backfill canonical tags from existing memories' tags TEXT column.
   * Processes memories in batches. Idempotent.
   */
  async backfillFromExistingTags(batchSize = 100): Promise<{
    processed: number;
    created: number;
    linked: number;
    aliases: number;
  }> {
    const sql = this.sql();
    let processed = 0;
    let created = 0;
    let linked = 0;
    let aliases = 0;

    // Get all memories with tags
    let offset = 0;
    while (true) {
      const rows = await sql`
        SELECT id, tags FROM memories
        WHERE tags IS NOT NULL AND tags != ''
        ORDER BY id
        LIMIT ${batchSize} OFFSET ${offset}
      `;
      if (rows.length === 0) break;

      for (const row of rows) {
        const rawTags = (row.tags as string)
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean);
        for (const raw of rawTags) {
          const { tagId, isNew } = await this.resolveOrCreateTag(raw);
          if (isNew) created++;
        }

        // Link to memory
        await this.linkMemoryTags(row.id, rawTags);
        linked += rawTags.length;
        processed++;
      }

      offset += batchSize;
      log(`[tag-registry] Backfill progress: ${processed} memories processed`);
    }

    return { processed, created, linked, aliases };
  }
}
