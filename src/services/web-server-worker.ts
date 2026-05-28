import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../config.js";
import {
  handleListTags,
  handleListMemories,
  handleAddMemory,
  handleDeleteMemory,
  handleBulkDelete,
  handleUpdateMemory,
  handleSearch,
  handleStats,
  handlePinMemory,
  handleUnpinMemory,
  handleDetectTagMigration,
  handleRunTagMigrationBatch,
  handleResetTagMigration,
  handleGetTagMigrationProgress,
  handleDeletePrompt,
  handleBulkDeletePrompts,
  handleGetUserProfile,
  handleGetProfileChangelog,
  handleGetProfileSnapshot,
  handleRefreshProfile,
  handleMigrationDetect,
  handleCleanup,
  handleDeduplicate,
  handleMigrationRun,
  handleListUserProfiles,
} from "./api-handlers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

const disableWebuiAuth = (CONFIG as any).disableWebuiAuth ?? false;
const disableClientAuth = (CONFIG as any).disableClientAuth ?? false;

async function parseBody(req: Request): Promise<any> {
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BODY_SIZE) {
    throw Object.assign(new Error("Request body too large"), { status: 413 });
  }
  const body = await req.text();
  if (body.length > MAX_BODY_SIZE) {
    throw Object.assign(new Error("Request body too large"), { status: 413 });
  }
  return JSON.parse(body);
}

const allowedOrigin = CONFIG.webServerAllowedOrigin ?? "*";

interface WorkerMessage {
  type: "start" | "stop" | "status";
  port?: number;
  host?: string;
}

interface WorkerResponse {
  type: "started" | "stopped" | "error" | "status";
  url?: string;
  error?: string;
  running?: boolean;
}

let server: any = null;

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  try {
    // Handle CORS preflight
    if (method === "OPTIONS") {
      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", allowedOrigin);
      headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      headers.set("Access-Control-Max-Age", "86400");
      if (allowedOrigin !== "*") {
        headers.set("Vary", "Origin");
      }
      return new Response(null, { status: 204, headers });
    }

    // Auth: /api/* routes require authentication unless disabled
    if (path.startsWith("/api/") && path !== "/api/health") {
      if (!disableWebuiAuth && !disableClientAuth && (CONFIG as any).server?.apiKey) {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
          return jsonResponse({ success: false, error: "Missing Authorization header" }, 401);
        }
        const parts = authHeader.split(" ");
        if (parts.length !== 2 || parts[0] !== "Bearer") {
          return jsonResponse({ success: false, error: "Invalid Authorization format" }, 401);
        }
        if (parts[1] !== (CONFIG as any).server!.apiKey) {
          return jsonResponse({ success: false, error: "Invalid API key" }, 401);
        }
      }
    }

    if (path === "/" || path === "/index.html") {
      return serveStaticFile("index.html", "text/html");
    }

    if (path === "/styles.css") {
      return serveStaticFile("styles.css", "text/css");
    }

    if (path === "/app.js") {
      return serveStaticFile("app.js", "application/javascript");
    }

    if (path === "/i18n.js") {
      return serveStaticFile("i18n.js", "application/javascript");
    }

    if (path === "/favicon.ico") {
      return serveStaticFile("favicon.ico", "image/x-icon");
    }

    if (path === "/api/tags" && method === "GET") {
      const result = await handleListTags();
      return jsonResponse(result);
    }

    if (path === "/api/memories" && method === "GET") {
      const tag = url.searchParams.get("tag") || undefined;
      const page = parseInt(url.searchParams.get("page") || "1");
      const pageSize = parseInt(url.searchParams.get("pageSize") || "20");
      const includePrompts = url.searchParams.get("includePrompts") !== "false";
      const userEmail = url.searchParams.get("userEmail") || undefined;
      const result = await handleListMemories(tag, page, pageSize, includePrompts, userEmail);
      return jsonResponse(result);
    }

    if (path === "/api/memories" && method === "POST") {
      const body = (await parseBody(req)) as any;
      const result = await handleAddMemory(body);
      return jsonResponse(result);
    }

    if (path.startsWith("/api/memories/") && method === "DELETE") {
      const parts = path.split("/");
      const id = parts[3];
      if (!id || id === "bulk-delete") {
        return jsonResponse({ success: false, error: "Invalid ID" });
      }
      const cascade = url.searchParams.get("cascade") === "true";
      const result = await handleDeleteMemory(id, cascade);
      return jsonResponse(result);
    }

    if (path.startsWith("/api/memories/") && method === "PUT") {
      const parts = path.split("/");
      const id = parts[3];
      if (!id) {
        return jsonResponse({ success: false, error: "Invalid ID" });
      }
      const body = (await parseBody(req)) as any;
      const result = await handleUpdateMemory(id, body);
      return jsonResponse(result);
    }

    if (path === "/api/memories/bulk-delete" && method === "POST") {
      const body = (await parseBody(req)) as any;
      const cascade = body.cascade !== false;
      const result = await handleBulkDelete(body.ids || [], cascade);
      return jsonResponse(result);
    }

    if (path === "/api/search" && method === "GET") {
      const query = url.searchParams.get("q");
      const tag = url.searchParams.get("tag") || undefined;
      const page = parseInt(url.searchParams.get("page") || "1");
      const pageSize = parseInt(url.searchParams.get("pageSize") || "20");
      const userEmail = url.searchParams.get("userEmail") || undefined;

      if (!query) {
        return jsonResponse({ success: false, error: "query parameter required" });
      }

      const result = await handleSearch(query, tag, page, pageSize, userEmail);
      return jsonResponse(result);
    }

    if (path === "/api/stats" && method === "GET") {
      const result = await handleStats();
      return jsonResponse(result);
    }

    if (path.match(/^\/api\/memories\/[^/]+\/pin$/) && method === "POST") {
      const id = path.split("/")[3];
      if (!id) {
        return jsonResponse({ success: false, error: "Invalid ID" });
      }
      const result = await handlePinMemory(id);
      return jsonResponse(result);
    }

    if (path.match(/^\/api\/memories\/[^/]+\/unpin$/) && method === "POST") {
      const id = path.split("/")[3];
      if (!id) {
        return jsonResponse({ success: false, error: "Invalid ID" });
      }
      const result = await handleUnpinMemory(id);
      return jsonResponse(result);
    }

    if (path === "/api/migration/tags/detect" && method === "GET") {
      const result = await handleDetectTagMigration();
      return jsonResponse(result);
    }

    if (path === "/api/migration/tags/reset" && method === "POST") {
      const result = await handleResetTagMigration();
      return jsonResponse(result);
    }

    if (path === "/api/migration/tags/run-batch" && method === "POST") {
      const body = (await parseBody(req)) as any;
      const batchSize = body?.batchSize || 5;
      const result = await handleRunTagMigrationBatch(batchSize);
      return jsonResponse(result);
    }

    if (path === "/api/migration/tags/progress" && method === "GET") {
      const result = await handleGetTagMigrationProgress();
      return jsonResponse(result);
    }

    if (path.startsWith("/api/prompts/") && method === "DELETE") {
      const parts = path.split("/");
      const id = parts[3];
      if (!id || id === "bulk-delete") {
        return jsonResponse({ success: false, error: "Invalid ID" });
      }
      const cascade = url.searchParams.get("cascade") === "true";
      const result = await handleDeletePrompt(id, cascade);
      return jsonResponse(result);
    }

    if (path === "/api/prompts/bulk-delete" && method === "POST") {
      const body = (await parseBody(req)) as any;
      const cascade = body.cascade !== false;
      const result = await handleBulkDeletePrompts(body.ids || [], cascade);
      return jsonResponse(result);
    }

    if (path === "/api/user-profile" && method === "GET") {
      const userId = url.searchParams.get("userId") || undefined;
      const result = await handleGetUserProfile(userId);
      return jsonResponse(result);
    }

    if (path === "/api/user-profile/changelog" && method === "GET") {
      const profileId = url.searchParams.get("profileId");
      const limit = parseInt(url.searchParams.get("limit") || "5");
      if (!profileId) {
        return jsonResponse({ success: false, error: "profileId parameter required" });
      }
      const result = await handleGetProfileChangelog(profileId, limit);
      return jsonResponse(result);
    }

    if (path === "/api/user-profile/snapshot" && method === "GET") {
      const changelogId = url.searchParams.get("chlogId");
      if (!changelogId) {
        return jsonResponse({ success: false, error: "changelogId parameter required" });
      }
      const result = await handleGetProfileSnapshot(changelogId);
      return jsonResponse(result);
    }

    if (path === "/api/user-profile/refresh" && method === "POST") {
      const body = (await parseBody(req).catch(() => ({}))) as any;
      const userId = body.userId || undefined;
      const result = await handleRefreshProfile(userId);
      return jsonResponse(result);
    }

    if (path === "/api/migration/detect" && method === "GET") {
      const result = handleMigrationDetect();
      return jsonResponse(result);
    }

    if (path === "/api/cleanup" && method === "POST") {
      const result = await handleCleanup();
      return jsonResponse(result);
    }

    if (path === "/api/deduplicate" && method === "POST") {
      const result = await handleDeduplicate();
      return jsonResponse(result);
    }

    if (path === "/api/migration/run" && method === "POST") {
      const body = await parseBody(req);
      const result = handleMigrationRun(body);
      return jsonResponse(result);
    }

    if (path === "/api/user-profiles" && method === "GET") {
      const result = await handleListUserProfiles();
      return jsonResponse(result);
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal error",
      },
      500
    );
  }
}

function serveStaticFile(filename: string, contentType: string): Response {
  try {
    const webDir = join(__dirname, "..", "web");
    const filePath = join(webDir, filename);

    if (contentType.startsWith("image/")) {
      const content = readFileSync(filePath);
      return new Response(content, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const content = readFileSync(filePath, "utf-8");

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    return new Response("File not found", { status: 404 });
  }
}

function jsonResponse(data: any, status: number = 200): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (allowedOrigin !== "*") {
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

declare const self: Worker;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case "start": {
        if (server) {
          self.postMessage({
            type: "error",
            error: "Server already running",
          } as WorkerResponse);
          return;
        }

        server = Bun.serve({
          port: message.port!,
          hostname: message.host!,
          fetch: handleRequest,
        });

        self.postMessage({
          type: "started",
          url: `http://${message.host}:${message.port}`,
        } as WorkerResponse);
        break;
      }

      case "stop": {
        if (server) {
          server.stop();
          server = null;
          self.postMessage({
            type: "stopped",
          } as WorkerResponse);
        } else {
          self.postMessage({
            type: "error",
            error: "Server not running",
          } as WorkerResponse);
        }
        break;
      }

      case "status": {
        self.postMessage({
          type: "status",
          running: server !== null,
        } as WorkerResponse);
        break;
      }

      default: {
        self.postMessage({
          type: "error",
          error: `Unknown message type: ${message.type}`,
        } as WorkerResponse);
        break;
      }
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      error: String(error),
    } as WorkerResponse);
  }
};
