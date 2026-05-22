import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { initConfig, CONFIG, isConfigured, getConfigErrors } from "../src/config.js";

describe("project-scoped config resolution", () => {
  let readSpy: ReturnType<typeof spyOn>;
  let existsSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    readSpy?.mockRestore();
    existsSpy?.mockRestore();
    // Reset to global-only config
    initConfig("/nonexistent-project");
  });

  it("uses global config when no project config exists", () => {
    existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const path = String(p);
      return path.includes(".config/opencode/opencode-mem");
    });
    readSpy = spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ opencodeModel: "global-model" })
    );
    initConfig("/some/project");
    expect(CONFIG.opencodeModel).toBe("global-model");
  });

  it("project config overrides global config", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = String(p);
      if (path.includes(".opencode/opencode-mem")) {
        return JSON.stringify({
          opencodeProvider: "openai",
          opencodeModel: "project-model",
        }) as any;
      }
      return JSON.stringify({
        opencodeProvider: "anthropic",
        opencodeModel: "global-model",
      }) as any;
    });
    initConfig("/my/project");
    expect(CONFIG.opencodeProvider).toBe("openai");
    expect(CONFIG.opencodeModel).toBe("project-model");
  });

  it("shallow merge: project adds fields, global fields preserved when not overridden", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = String(p);
      if (path.includes(".opencode/opencode-mem")) {
        return JSON.stringify({ opencodeProvider: "anthropic" }) as any;
      }
      return JSON.stringify({ opencodeModel: "claude-haiku", autoCaptureEnabled: false }) as any;
    });
    initConfig("/my/project");
    expect(CONFIG.opencodeProvider).toBe("anthropic");
    expect(CONFIG.opencodeModel).toBe("claude-haiku");
    expect(CONFIG.autoCaptureEnabled).toBe(false);
  });

  it("falls back to defaults when neither global nor project config exists", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    initConfig("/no/config/project");
    expect(CONFIG.autoCaptureEnabled).toBe(true); // default value
    expect(CONFIG.opencodeProvider).toBeUndefined();
  });
});

describe("required config validation", () => {
  let readSpy: ReturnType<typeof spyOn>;
  let existsSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    readSpy?.mockRestore();
    existsSpy?.mockRestore();
    initConfig("/nonexistent-project");
  });

  it("flags missing postgres.url", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        embeddingApiUrl: "https://api.openai.com/v1",
        embeddingModel: "text-embedding-3-small",
        embeddingApiKey: "sk-test",
      }) as any;
    });
    initConfig("/no-pg-url/project");
    expect(isConfigured()).toBe(false);
    expect(getConfigErrors().some((e) => e.includes("postgres.url"))).toBe(true);
  });

  it("flags missing embeddingApiUrl", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        postgres: { url: "postgres://user:pass@localhost:5432/testdb" },
        embeddingModel: "text-embedding-3-small",
        embeddingApiKey: "sk-test",
      }) as any;
    });
    initConfig("/no-embed-url/project");
    expect(isConfigured()).toBe(false);
    expect(getConfigErrors().some((e) => e.includes("embeddingApiUrl"))).toBe(true);
  });

  it("flags missing embeddingModel", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        postgres: { url: "postgres://user:pass@localhost:5432/testdb" },
        embeddingApiUrl: "https://api.openai.com/v1",
        embeddingApiKey: "sk-test",
      }) as any;
    });
    initConfig("/no-embed-model/project");
    expect(isConfigured()).toBe(false);
    expect(getConfigErrors().some((e) => e.includes("embeddingModel"))).toBe(true);
  });

  it("isConfigured returns true when all required fields are provided", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        postgres: { url: "postgres://user:pass@localhost:5432/testdb" },
        embeddingApiUrl: "https://api.openai.com/v1",
        embeddingModel: "text-embedding-3-small",
        embeddingApiKey: "sk-test",
      }) as any;
    });
    initConfig("/valid/project");
    expect(isConfigured()).toBe(true);
    expect(getConfigErrors()).toHaveLength(0);
  });
});

describe("embeddingMaxTokens config resolution", () => {
  let readSpy: ReturnType<typeof spyOn>;
  let existsSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    readSpy?.mockRestore();
    existsSpy?.mockRestore();
    initConfig("/nonexistent-project");
  });

  it("embeddingMaxTokens can be partially overridden", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        embeddingMaxTokens: { content: 4096 },
      }) as any;
    });
    initConfig("/override/project");
    expect(CONFIG.embeddingMaxTokens.content).toBe(4096);
    // Other fields keep defaults
    expect(CONFIG.embeddingMaxTokens.tags).toBe(256);
    expect(CONFIG.embeddingMaxTokens.query).toBe(512);
    expect(CONFIG.embeddingMaxTokens.migration).toBe(2048);
  });

  it("resolves postgres.url via env:// secret reference", () => {
    process.env.TEST_PG_URL = "postgres://envuser:envpass@localhost:5432/envdb";
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        postgres: { url: "env://TEST_PG_URL" },
      }) as any;
    });
    initConfig("/env/project");
    expect(CONFIG.postgres.url).toBe("postgres://envuser:envpass@localhost:5432/envdb");
    delete process.env.TEST_PG_URL;
  });
});
