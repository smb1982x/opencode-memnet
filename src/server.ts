// src/server.ts — Standalone server entry point
import { initServerConfig, validateServerConfig } from "./server-config.js";
import { initializeStorage } from "./services/storage/factory.js";
import { embeddingService } from "./services/embedding.js";
import { setDbConnected } from "./services/health-handler.js";
import { startWebServer } from "./services/web-server.js";
import { log } from "./services/logger.js";

async function main(): Promise<void> {
  log("opencode-mem server starting...");

  // 1. Load and validate config
  const config = initServerConfig();
  const errors = validateServerConfig(config);
  if (errors.length > 0) {
    console.error("Configuration errors:");
    errors.forEach((e) => console.error("  -", e));
    process.exit(1);
  }

  // Bridge server config into global CONFIG for storage/embedding layers
  const { serverConfigToGlobalConfig } = await import("./config.js");
  serverConfigToGlobalConfig(config);

  // 2. Initialize storage (runs DB migrations)
  try {
    await initializeStorage();
    setDbConnected(true);
    log("Storage initialized (migrations complete)");
  } catch (error) {
    console.error("Failed to initialize storage:", error);
    process.exit(1);
  }

  // 3. Warm up embedding service
  try {
    await embeddingService.warmup();
    log("Embedding service ready");
  } catch (error) {
    console.error("Failed to warm up embedding service:", error);
    process.exit(1);
  }

  // 4. Start HTTP server
  try {
    const server = await startWebServer(
      {
        port: config.port,
        host: config.host,
        enabled: true,
        allowedOrigin: config.webServerAllowedOrigin,
      },
      config.serverApiKey
    );

    log(`Server listening on http://${config.host}:${config.port}`);
    log(`WebUI: http://${config.host}:${config.port}/`);
    log(`Health: http://${config.host}:${config.port}/api/health`);

    // 5. Graceful shutdown
    const shutdown = async () => {
      log("Shutting down...");
      try {
        await server.stop();
      } catch (e) {
        log("Error stopping server", { error: String(e) });
      }
      try {
        const { closeStorage } = await import("./services/storage/factory.js");
        await closeStorage();
      } catch (e) {
        log("Error closing storage", { error: String(e) });
      }
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();
