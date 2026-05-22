import { describe, expect, it } from "bun:test";
import pkg from "../package.json";

describe("published dependency constraints", () => {
  it("depends on postgres for the storage backend", () => {
    expect(pkg.dependencies["postgres"]).toBeDefined();
  });

  it("does not depend on removed SQLite or Xenova packages", () => {
    expect(pkg.dependencies).not.toHaveProperty("@xenova/transformers");
    expect(pkg.dependencies).not.toHaveProperty("usearch");
    expect(pkg.dependencies).not.toHaveProperty("better-sqlite3");
  });
});
