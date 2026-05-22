// src/plugin.ts
import type { PluginModule } from "@opencode-ai/plugin";
import pkg from "../package.json" with { type: "json" };

export const id =
  typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : "opencode-mem";

async function resolvePlugin() {
  try {
    const { initClientConfig } = await import("./config.js");
    initClientConfig(process.cwd());
    const { isClientConfigured } = await import("./config.js");
    if (isClientConfigured()) {
      const { OpenCodeMemPlugin } = await import("./index-remote.js");
      return OpenCodeMemPlugin;
    }
  } catch {
    // Fall through to in-process plugin
  }

  const { OpenCodeMemPlugin } = await import("./index.js");
  return OpenCodeMemPlugin;
}

const OpenCodeMemPlugin = await resolvePlugin();
export { OpenCodeMemPlugin };
export default { id, server: OpenCodeMemPlugin } satisfies PluginModule;
