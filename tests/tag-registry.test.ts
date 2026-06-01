import { describe, it, expect } from "bun:test";
import {
  normalizeTagName,
  canonicalizeTagName,
} from "../src/services/storage/postgres/tag-registry.js";

describe("tag-registry normalization", () => {
  describe("normalizeTagName", () => {
    it("should lowercase tags", () => {
      expect(normalizeTagName("React")).toBe("react");
      expect(normalizeTagName("AUTH")).toBe("auth");
    });

    it("should trim whitespace", () => {
      expect(normalizeTagName("  react  ")).toBe("react");
      expect(normalizeTagName("\t docker \n")).toBe("docker");
    });

    it("should replace spaces with hyphens", () => {
      expect(normalizeTagName("bug fix")).toBe("bug-fix");
      expect(normalizeTagName("react hooks")).toBe("react-hooks");
    });

    it("should replace underscores with hyphens", () => {
      expect(normalizeTagName("bug_fix")).toBe("bug-fix");
      expect(normalizeTagName("api_key")).toBe("api-key");
    });

    it("should collapse multiple hyphens", () => {
      expect(normalizeTagName("api--key")).toBe("api-key");
      expect(normalizeTagName("bug---fix")).toBe("bug-fix");
    });

    it("should strip leading/trailing hyphens", () => {
      expect(normalizeTagName("-react-")).toBe("react");
      expect(normalizeTagName("--docker--")).toBe("docker");
    });

    it("should handle complex normalization", () => {
      expect(normalizeTagName("  API Key Auth  ")).toBe("api-key-auth");
      expect(normalizeTagName("CI/CD")).toBe("ci/cd");
    });

    it("should return empty string for whitespace-only input", () => {
      expect(normalizeTagName("   ")).toBe("");
      expect(normalizeTagName("\t\n")).toBe("");
    });
  });

  describe("canonicalizeTagName", () => {
    it("should sort two-term reversible tags alphabetically", () => {
      expect(canonicalizeTagName("security-login")).toBe("login-security");
      expect(canonicalizeTagName("login-security")).toBe("login-security");
      expect(canonicalizeTagName("queue-job")).toBe("job-queue");
      expect(canonicalizeTagName("job-queue")).toBe("job-queue");
    });

    it("should NOT reorder order-sensitive phrases", () => {
      expect(canonicalizeTagName("blue-green-deployment")).toBe("blue-green-deployment");
      expect(canonicalizeTagName("ci-cd")).toBe("ci-cd");
      expect(canonicalizeTagName("rate-limiting")).toBe("rate-limiting");
      expect(canonicalizeTagName("circuit-breaker")).toBe("circuit-breaker");
      expect(canonicalizeTagName("connection-pooling")).toBe("connection-pooling");
      expect(canonicalizeTagName("api-key-authentication")).toBe("api-key-authentication");
    });

    it("should not reorder single-word tags", () => {
      expect(canonicalizeTagName("react")).toBe("react");
      expect(canonicalizeTagName("docker")).toBe("docker");
      expect(canonicalizeTagName("authentication")).toBe("authentication");
    });

    it("should not reorder three-plus-term tags", () => {
      expect(canonicalizeTagName("blue-green-deployment")).toBe("blue-green-deployment");
      expect(canonicalizeTagName("pdf-generation")).toBe("pdf-generation");
    });

    it("should handle test cases from the issue", () => {
      // security-login → login-security (sorted)
      expect(canonicalizeTagName("security-login")).toBe("login-security");
      // config-management stays (already sorted: c < m)
      expect(canonicalizeTagName("config-management")).toBe("config-management");
    });
  });
});
