import { afterAll, describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "opencode-mem-test-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = home;
process.env.USERPROFILE = home;

const { CONFIG, isConfigured } = await import("../src/config.js");

afterAll(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
});

describe("config", () => {
  describe("CONFIG defaults", () => {
    it("should have a storagePath containing .opencode-mem", () => {
      expect(CONFIG.storagePath).toContain(".opencode-mem");
    });

    it("should have numeric embeddingDimensions", () => {
      expect(typeof CONFIG.embeddingDimensions).toBe("number");
      expect(CONFIG.embeddingDimensions).toBeGreaterThan(0);
    });

    it("should have similarityThreshold between 0 and 1", () => {
      expect(CONFIG.similarityThreshold).toBeGreaterThanOrEqual(0);
      expect(CONFIG.similarityThreshold).toBeLessThanOrEqual(1);
    });

    it("should have positive maxMemories", () => {
      expect(CONFIG.maxMemories).toBeGreaterThan(0);
    });

    it("should have webServerPort as a number", () => {
      expect(typeof CONFIG.webServerPort).toBe("number");
    });

    it("should have webServerHost as a string", () => {
      expect(typeof CONFIG.webServerHost).toBe("string");
    });

    it("should have compaction settings", () => {
      expect(CONFIG.compaction).toBeDefined();
      expect(typeof CONFIG.compaction.enabled).toBe("boolean");
      expect(typeof CONFIG.compaction.memoryLimit).toBe("number");
    });

    it("should have chatMessage settings", () => {
      expect(CONFIG.chatMessage).toBeDefined();
      expect(typeof CONFIG.chatMessage.enabled).toBe("boolean");
      expect(typeof CONFIG.chatMessage.maxMemories).toBe("number");
      expect(typeof CONFIG.chatMessage.excludeCurrentSession).toBe("boolean");
    });

    it("should have chatMessage.injectOn as 'first' or 'always'", () => {
      expect(["first", "always"]).toContain(CONFIG.chatMessage.injectOn);
    });

    it("should have boolean toggle settings", () => {
      expect(typeof CONFIG.autoCaptureEnabled).toBe("boolean");
      expect(typeof CONFIG.injectProfile).toBe("boolean");
      expect(typeof CONFIG.webServerEnabled).toBe("boolean");
    });

    it("should expose memory scope config", () => {
      const defaultScope = CONFIG.memory.defaultScope ?? "project";
      expect(["project", "all-projects"]).toContain(defaultScope);
    });

    it("should have user profile settings as numbers", () => {
      expect(typeof CONFIG.userProfileAnalysisInterval).toBe("number");
      expect(typeof CONFIG.userProfileMaxPreferences).toBe("number");
      expect(typeof CONFIG.userProfileMaxPatterns).toBe("number");
      expect(typeof CONFIG.userProfileMaxWorkflows).toBe("number");
      expect(typeof CONFIG.userProfileConfidenceDecayDays).toBe("number");
      expect(typeof CONFIG.userProfileChangelogRetentionCount).toBe("number");
    });

    it("should have toast settings as booleans", () => {
      expect(typeof CONFIG.showAutoCaptureToasts).toBe("boolean");
      expect(typeof CONFIG.showUserProfileToasts).toBe("boolean");
      expect(typeof CONFIG.showErrorToasts).toBe("boolean");
    });

    it("should have postgres config with defaults", () => {
      expect(CONFIG.postgres).toBeDefined();
      expect(CONFIG.postgres.ssl).toBe("require");
      expect(CONFIG.postgres.maxConnections).toBe(10);
      expect(CONFIG.postgres.idleTimeoutSeconds).toBe(30);
      expect(CONFIG.postgres.connectTimeoutSeconds).toBe(10);
      expect(CONFIG.postgres.vectorType).toBe("vector");
      expect(CONFIG.postgres.hnswEfSearch).toBe(128);
      expect(CONFIG.postgres.hnswEfConstruction).toBe(256);
    });

    it("should have embeddingMaxTokens defaults", () => {
      expect(CONFIG.embeddingMaxTokens).toBeDefined();
      expect(CONFIG.embeddingMaxTokens.content).toBe(2048);
      expect(CONFIG.embeddingMaxTokens.tags).toBe(256);
      expect(CONFIG.embeddingMaxTokens.query).toBe(512);
      expect(CONFIG.embeddingMaxTokens.migration).toBe(2048);
    });

    it("should have embeddingTruncationSide defaults", () => {
      expect(CONFIG.embeddingTruncationSide).toBeDefined();
      expect(CONFIG.embeddingTruncationSide.content).toBe("right");
      expect(CONFIG.embeddingTruncationSide.tags).toBe("right");
      expect(CONFIG.embeddingTruncationSide.query).toBe("right");
      expect(CONFIG.embeddingTruncationSide.migration).toBe("right");
    });
  });

  describe("isConfigured", () => {
    it("should return false when required fields are missing", () => {
      expect(isConfigured()).toBe(false);
    });

    it("should return a boolean", () => {
      expect(typeof isConfigured()).toBe("boolean");
    });
  });
});
