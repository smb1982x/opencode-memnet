import { CONFIG } from "../config.js";
import { log } from "./logger.js";

const TIMEOUT_MS = 30000;
const GLOBAL_EMBEDDING_KEY = Symbol.for("opencode-mem.embedding.instance");
const MAX_CACHE_SIZE = 100;
const CHARS_PER_TOKEN = 4;

export type EmbeddingKind = "content" | "tags" | "query" | "migration";

export interface EmbeddingOptions {
  kind?: EmbeddingKind;
  truncationSide?: "left" | "right";
}

function resolveMaxTokens(kind: EmbeddingKind): number {
  return CONFIG.embeddingMaxTokens[kind] ?? 2048;
}

function resolveTruncationSide(kind: EmbeddingKind, side?: "left" | "right"): "left" | "right" {
  return side ?? CONFIG.embeddingTruncationSide[kind] ?? "right";
}

function truncateText(text: string, maxTokens: number, side: "left" | "right"): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  if (side === "right") {
    // Keep the beginning
    return text.slice(0, maxChars);
  }
  // Left: keep the end
  return text.slice(text.length - maxChars);
}

export class EmbeddingService {
  public isWarmedUp: boolean = false;
  private cache: Map<string, Float32Array> = new Map();
  private cachedModelName: string | null = null;

  static getInstance(): EmbeddingService {
    if (!(globalThis as any)[GLOBAL_EMBEDDING_KEY]) {
      (globalThis as any)[GLOBAL_EMBEDDING_KEY] = new EmbeddingService();
    }
    return (globalThis as any)[GLOBAL_EMBEDDING_KEY];
  }

  async warmup(_progressCallback?: (progress: any) => void): Promise<void> {
    this.isWarmedUp = true;
  }

  async embed(
    text: string,
    options?: EmbeddingOptions,
    signal?: AbortSignal
  ): Promise<Float32Array> {
    const currentModel = CONFIG.embeddingModel ?? null;
    if (this.cachedModelName !== currentModel) {
      this.clearCache();
      this.cachedModelName = currentModel;
    }

    const kind: EmbeddingKind = options?.kind ?? "content";
    const maxTokens = resolveMaxTokens(kind);
    const side = resolveTruncationSide(kind, options?.truncationSide);

    // Truncate before cache lookup
    const effectiveText = truncateText(text, maxTokens, side);

    // Cache key includes model, kind, maxTokens, side, and truncated/effective text
    const cacheKey = `${CONFIG.embeddingModel}:${kind}:${maxTokens}:${side}:${effectiveText}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      // LRU: move accessed entry to end of Map
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }

    if (!this.isWarmedUp) {
      await this.warmup();
    }

    let result: Float32Array;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (CONFIG.embeddingApiKey) {
      headers["Authorization"] = `Bearer ${CONFIG.embeddingApiKey}`;
    }

    if (side === "left") {
      // For remote API with left truncation, pass truncate_prompt_tokens and try to avoid
      // app-side truncation if possible (let the server do it).
      // We still need to pass effectiveText as input; for left, effectiveText already has
      // the beginning trimmed. We send truncate_prompt_tokens so the API can further truncate.
      const response = await fetch(`${CONFIG.embeddingApiUrl}/embeddings`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          input: text.length > effectiveText.length ? effectiveText : text,
          model: CONFIG.embeddingModel,
          truncate_prompt_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`API embedding failed: ${response.statusText}`);
      }

      const data: any = await response.json();
      if (!Array.isArray(data.data) || data.data.length === 0) {
        throw new Error("Embedding API returned empty data array");
      }
      const embLeft = data.data[0]?.embedding;
      if (!Array.isArray(embLeft) || embLeft.length === 0) {
        throw new Error("Embedding API returned empty or missing embedding vector");
      }
      result = new Float32Array(embLeft);
    } else {
      // Right truncation: app-side already done, do not send truncate_prompt_tokens
      const response = await fetch(`${CONFIG.embeddingApiUrl}/embeddings`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          input: effectiveText,
          model: CONFIG.embeddingModel,
        }),
      });

      if (!response.ok) {
        throw new Error(`API embedding failed: ${response.statusText}`);
      }

      const data: any = await response.json();
      if (!Array.isArray(data.data) || data.data.length === 0) {
        throw new Error("Embedding API returned empty data array");
      }
      const embRight = data.data[0]?.embedding;
      if (!Array.isArray(embRight) || embRight.length === 0) {
        throw new Error("Embedding API returned empty or missing embedding vector");
      }
      result = new Float32Array(embRight);
    }

    if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, result);

    return result;
  }

  async embedWithTimeout(text: string, options?: EmbeddingOptions): Promise<Float32Array> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await this.embed(text, options, controller.signal);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const embeddingService = EmbeddingService.getInstance();
