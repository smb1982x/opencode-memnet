/**
 * Unit tests for storage factory routing.
 *
 * Verifies the factory creates Postgres-backed repository singletons
 * without actually connecting to any database.
 *
 * The lazy proxies use dynamic imports, so we verify the proxy class
 * exposes the expected interface methods.
 */

import { describe, expect, it } from "bun:test";

describe("Storage factory routing (Postgres-only)", () => {
  it("createMemoryRepository returns a lazy proxy with the expected methods", async () => {
    const { createMemoryRepository } = await import("../../src/services/storage/factory.js");

    const repo = createMemoryRepository();
    expect(typeof repo.initialize).toBe("function");
    expect(typeof repo.insert).toBe("function");
    expect(typeof repo.search).toBe("function");
    expect(typeof repo.delete).toBe("function");
    expect(typeof repo.update).toBe("function");
    expect(typeof repo.getById).toBe("function");
    expect(typeof repo.list).toBe("function");
    expect(typeof repo.getBySessionId).toBe("function");
    expect(typeof repo.count).toBe("function");
    expect(typeof repo.getDistinctTags).toBe("function");
    expect(typeof repo.pin).toBe("function");
    expect(typeof repo.unpin).toBe("function");
    expect(typeof repo.listOlderThan).toBe("function");
    expect(typeof repo.getAllWithVectors).toBe("function");
    expect(typeof repo.countUntagged).toBe("function");
    expect(typeof repo.updateTagsAndVectors).toBe("function");
    expect(typeof repo.close).toBe("function");
  });

  it("createUserPromptRepository returns a lazy proxy with the expected methods", async () => {
    const { createUserPromptRepository } = await import("../../src/services/storage/factory.js");

    const repo = createUserPromptRepository();
    expect(typeof repo.initialize).toBe("function");
    expect(typeof repo.savePrompt).toBe("function");
    expect(typeof repo.getLastUncapturedPrompt).toBe("function");
    expect(typeof repo.deletePrompt).toBe("function");
    expect(typeof repo.markAsCaptured).toBe("function");
    expect(typeof repo.claimPrompt).toBe("function");
    expect(typeof repo.countUncapturedPrompts).toBe("function");
    expect(typeof repo.getUncapturedPrompts).toBe("function");
    expect(typeof repo.markMultipleAsCaptured).toBe("function");
    expect(typeof repo.close).toBe("function");
  });

  it("createUserProfileRepository returns a lazy proxy with the expected methods", async () => {
    const { createUserProfileRepository } = await import("../../src/services/storage/factory.js");

    const repo = createUserProfileRepository();
    expect(typeof repo.initialize).toBe("function");
    expect(typeof repo.getActiveProfile).toBe("function");
    expect(typeof repo.createProfile).toBe("function");
    expect(typeof repo.updateProfile).toBe("function");
    expect(typeof repo.mergeProfileData).toBe("function");
    expect(typeof repo.close).toBe("function");
  });

  it("createAISessionRepository returns a lazy proxy with the expected methods", async () => {
    const { createAISessionRepository } = await import("../../src/services/storage/factory.js");

    const repo = createAISessionRepository();
    expect(typeof repo.initialize).toBe("function");
    expect(typeof repo.getSession).toBe("function");
    expect(typeof repo.createSession).toBe("function");
    expect(typeof repo.addMessage).toBe("function");
    expect(typeof repo.getMessages).toBe("function");
    expect(typeof repo.getLastSequence).toBe("function");
    expect(typeof repo.cleanupExpiredSessions).toBe("function");
    expect(typeof repo.close).toBe("function");
  });

  it("factory returns singleton instances", async () => {
    const {
      createMemoryRepository,
      createUserPromptRepository,
      createUserProfileRepository,
      createAISessionRepository,
    } = await import("../../src/services/storage/factory.js");

    expect(createMemoryRepository()).toBe(createMemoryRepository());
    expect(createUserPromptRepository()).toBe(createUserPromptRepository());
    expect(createUserProfileRepository()).toBe(createUserProfileRepository());
    expect(createAISessionRepository()).toBe(createAISessionRepository());
  });
});
