// tag-migration-service.ts — perpetual background tag migration loop
// Runs on server startup, auto-detects untagged memories, and uses the AI
// provider to generate tags until all memories are tagged. Exposes progress
// via getMigrationProgress() for the WebUI status bar.

import { CONFIG } from "../config.js";
import { log, logError } from "./logger.js";
import { embeddingService } from "./embedding.js";
import type { MemoryRecord } from "./storage/types.js";

interface MigrationState {
  status: "idle" | "running";
  processed: number;
  total: number;
  errors: string[];
}

let _state: MigrationState = { status: "idle", processed: 0, total: 0, errors: [] };
let _abortController: AbortController | null = null;

export function getMigrationProgress(): MigrationState {
  return { ..._state };
}

export function stopMigration(): void {
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
  _state = { status: "idle", processed: 0, total: 0, errors: [] };
}

const RETRY_LIMIT = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_EXISTING_TAGS_HINT = 25;

async function tagMemory(
  memory: MemoryRecord,
  existingTags: string[],
  provider: any
): Promise<string[] | null> {
  // Only include a limited sample of existing tags to avoid the LLM over-tagging
  // from a large tag vocabulary. Pick up to MAX_EXISTING_TAGS_HINT tags.
  const tagHint = existingTags.length > 0 ? existingTags.slice(0, MAX_EXISTING_TAGS_HINT) : [];

  // Load existing canonical tags for the prompt
  let existingTagsStr = "(none yet)";
  try {
    const { createTagRegistry } = await import("./storage/factory.js");
    const registry = createTagRegistry();
    const tagNames = await registry.getCanonicalTagNames(25);
    if (tagNames.length > 0) {
      existingTagsStr = tagNames.join(", ");
    }
  } catch {
    // Tag registry may not be initialized yet
  }

  const systemPrompt = `You are a technical tag classifier for software development memories.
Your ONLY job is to generate exactly 2-4 concise, lowercase technical tags.

RULES:
1. EVERY memory MUST receive at least 1 tag — "skip" or empty is not allowed
2. You MUST return between 2 and 4 tags — never more than 4, never less than 2
3. PREFER EXISTING TAGS from the provided list — reuse them wherever possible
4. Only create a NEW tag if the memory contains an important concept not covered by any existing tag
5. Tags must be lowercase, hyphenated compound words (e.g., "bug-fix", "ci-cd", "react-hooks")
6. Never use generic tags like "misc", "other", "general"
7. Prefer stable nouns, technology names, system components, categories, or concepts
8. Avoid verbs, gerunds (e.g., "authenticating"), arbitrary abbreviations, and one-off phrases
9. If an existing tag is close enough to describe the concept, use it

EXISTING CANONICAL TAGS (prefer these):
${existingTagsStr}

Use these existing tags wherever they fit. Only propose a new tag if no existing tag accurately describes an important concept in the memory.`;

  const prompt = `Generate 2-4 technical tags for this memory content:\n\nMemory content:\n${memory.content}\n\nReturn a JSON object with a "tags" array containing 2-4 tags.`;

  const toolSchema = {
    type: "function" as const,
    function: {
      name: "save_tags",
      description: "Save generated tags for the memory",
      parameters: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 4,
            description: "Exactly 2-4 technical tags for the memory",
          },
        },
        required: ["tags"],
      },
    },
  };

  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      const result = await provider.executeToolCall(
        systemPrompt,
        prompt,
        toolSchema,
        `migrate_${memory.id}_${attempt}`
      );
      if (result.success && result.data?.tags && result.data.tags.length > 0) {
        // Hard-cap at 4 tags regardless of what the LLM returns
        return result.data.tags
          .map((t: string) => t.trim().toLowerCase())
          .filter((t: string) => t.length > 0)
          .slice(0, 4);
      }
      if (attempt < RETRY_LIMIT) {
        await sleep(1000 * attempt); // exponential-ish backoff: 1s, 2s, 3s
      }
    } catch (e) {
      log("tag-migration: AI call failed", { id: memory.id, attempt, error: String(e) });
      if (attempt < RETRY_LIMIT) {
        await sleep(1000 * attempt);
      }
    }
  }

  return null; // gave up after retries
}

export async function runTagMigration(): Promise<void> {
  if (_state.status === "running") return;

  _abortController = new AbortController();
  const signal = _abortController.signal;

  _state = { status: "running", processed: 0, total: 0, errors: [] };

  try {
    const { createMemoryRepository } = await import("./storage/factory.js");
    const memoryRepo = createMemoryRepository();

    while (!signal.aborted) {
      const untaggedCount = await memoryRepo.countUntagged();
      if (untaggedCount === 0) {
        _state = {
          status: "idle",
          processed: _state.processed,
          total: _state.processed,
          errors: [],
        };
        await sleep(5000); // wait before next check
        continue;
      }

      const existingTags = await memoryRepo.getDistinctTagValues({ scope: "project" });
      const allRecords = (await memoryRepo.getAllWithVectors()).filter((r) =>
        r.containerTag.includes("_project_")
      );

      const untagged = allRecords.filter((r) => !r.tags || r.tags.trim() === "");
      _state.status = "running";
      _state.total = untagged.length;
      _state.processed = 0;
      _state.errors = [];

      // Warm up embedding service once per batch
      await embeddingService.warmup();

      // Set up AI provider
      const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
      const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");
      const providerConfig = buildMemoryProviderConfig(CONFIG, {
        maxIterations: 1,
        iterationTimeout: 30000,
      });
      const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);

      for (const mem of untagged) {
        if (signal.aborted) return;

        const tags = await tagMemory(mem, existingTags, provider);

        if (tags && tags.length > 0) {
          try {
            const vector = await embeddingService.embedWithTimeout(mem.content, {
              kind: "content",
            });
            const tagsStr = tags.join(",");
            const tagsVector = await embeddingService.embedWithTimeout(tagsStr, { kind: "tags" });

            await memoryRepo.updateTagsAndVectors(mem.id, tagsStr, vector, tagsVector, Date.now());

            // Dual-write: also store in canonical tag registry
            try {
              const { createTagRegistry } = await import("./storage/factory.js");
              const registry = createTagRegistry();
              await registry.linkMemoryTags(mem.id, tags);
            } catch (err) {
              logError("tag-migration: failed to link tags in registry", { error: String(err) });
            }
          } catch (e) {
            _state.errors.push(`Failed to update vectors for ${mem.id}: ${String(e)}`);
          }
        } else {
          _state.errors.push(`Failed to generate tags for memory ${mem.id}`);
        }

        _state.processed++;
      }

      // Check if we're done
      const remaining = await memoryRepo.countUntagged();
      if (remaining === 0) {
        _state = { status: "idle", processed: _state.total, total: _state.total, errors: [] };
        await sleep(5000);
        continue;
      }

      // Wait before next round (avoid hammering the AI API)
      await sleep(5000);
    }
  } catch (error) {
    log("tag-migration: fatal error", { error: String(error) });
    _state.errors.push(String(error));
  } finally {
    if (_state.status === "running") {
      _state.status = "idle";
    }
    _abortController = null;
  }
}
