// plugin/src/index-remote.ts — Thin remote client plugin
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { tool } from "@opencode-ai/plugin";

import { remoteMemoryClient } from "./services/remote-client.js";
import { getTags, type TagsConfig } from "../../shared/tags.js";
import { stripPrivateContent, isFullyPrivate } from "../../shared/privacy.js";

import { isClientConfigured, CLIENT_CONFIG, initClientConfig } from "../../shared/client-config.js";
import { log, logInfo, logWarn, logError, logDebug } from "../../shared/logger.js";

// NOTE: Must match src/config.ts DEFAULTS.containerTagPrefix — if server changes this, update both places.
const TAGS_CONFIG: TagsConfig = {
  containerTagPrefix: "opencode",
  userEmailOverride: undefined,
  userNameOverride: undefined,
};

export const OpenCodeMemPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  initClientConfig(directory);

  if (!isClientConfigured()) {
    log("Remote plugin not configured — check serverUrl and apiKey in config.");
    return {};
  }

  const tags = await getTags(directory, TAGS_CONFIG);
  logInfo("Plugin initialized", {
    project: tags.project.projectName || tags.project.tag,
    user: tags.user.userEmail || "unknown",
  });
  let idleTimeout: Timer | null = null;
  let captureInProgress = false;

  return {
    "chat.message": async (input, output) => {
      if (!isClientConfigured() || !CLIENT_CONFIG.chatMessage.enabled) return;
      logDebug("chat.message hook fired", {
        sessionId: input.sessionID,
        partsCount: output.parts.length,
        partTypes: output.parts.map((p: any) => p.type),
        enabled: CLIENT_CONFIG.chatMessage.enabled,
        maxMemories: CLIENT_CONFIG.chatMessage.maxMemories,
      });

      try {
        const textParts = output.parts.filter(
          (p): p is Part & { type: "text"; text: string } => p.type === "text"
        );
        if (textParts.length === 0) return;
        const userMessage = textParts.map((p) => p.text).join("\n");
        if (!userMessage.trim()) return;

        const ctxResult = await remoteMemoryClient.getContext({
          sessionID: input.sessionID,
          projectTag: tags.project.tag,
          userId: tags.user.userEmail || undefined,
          maxMemories: CLIENT_CONFIG.chatMessage.maxMemories,
          excludeCurrentSession: CLIENT_CONFIG.chatMessage.excludeCurrentSession,
          maxAgeDays: CLIENT_CONFIG.chatMessage.maxAgeDays,
        });

        if (ctxResult.success && ctxResult.data && ctxResult.data.context) {
          const contextPart: Part = {
            id: `prt-memory-context-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: ctxResult.data.context,
            synthetic: true,
          } as any;
          output.parts.unshift(contextPart);
          logDebug("Memory context injected", {
            sessionId: input.sessionID,
            contextLength: ctxResult.data.context?.length,
            memoriesCount: ctxResult.data.memories?.length,
            profileInjected: ctxResult.data.profileInjected,
          });
        }
      } catch (error) {
        logError("chat.message: ERROR", { error: String(error) });
      }
    },

    tool: {
      memory: tool({
        description: `Manage and query project memory`,
        args: {
          mode: tool.schema.enum(["add", "search", "profile", "list", "forget", "help"]).optional(),
          content: tool.schema.string().optional(),
          query: tool.schema.string().optional(),
          tags: tool.schema.string().optional(),
          type: tool.schema.string().optional(),
          memoryId: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
          scope: tool.schema.enum(["project", "all-projects"]).optional(),
        },
        async execute(args, toolCtx) {
          if (!isClientConfigured()) {
            return JSON.stringify({ success: false, error: "Memory system not configured." });
          }
          logDebug("memory tool called", { 
            mode: args.mode || "help", 
            hasContent: !!args.content, 
            hasQuery: !!args.query,
            scope: args.scope,
            limit: args.limit,
          });

          const mode = args.mode || "help";

          try {
            switch (mode) {
              case "help":
                return JSON.stringify({
                  success: true,
                  commands: [
                    {
                      command: "add",
                      description: "Store new memory",
                      args: ["content", "type?", "tags?"],
                    },
                    {
                      command: "search",
                      description: "Search memories via keywords",
                      args: ["query"],
                    },
                    { command: "profile", description: "View user profile", args: [] },
                    { command: "list", description: "List recent memories", args: ["limit?"] },
                    { command: "forget", description: "Remove memory", args: ["memoryId"] },
                  ],
                });

              case "add": {
                if (!args.content)
                  return JSON.stringify({ success: false, error: "content required" });
                const sanitized = stripPrivateContent(args.content);
                if (isFullyPrivate(args.content))
                  return JSON.stringify({ success: false, error: "Private content blocked" });
                const parsedTags = args.tags
                  ? args.tags.split(",").map((t) => t.trim().toLowerCase())
                  : undefined;
                const result = await remoteMemoryClient.addMemory(sanitized, tags.project.tag, {
                  type: args.type as any,
                  tags: parsedTags,
                  displayName: tags.project.displayName,
                  userName: tags.project.userName,
                  userEmail: tags.project.userEmail,
                  projectPath: tags.project.projectPath,
                  projectName: tags.project.projectName,
                  gitRepoUrl: tags.project.gitRepoUrl,
                });
                return JSON.stringify({
                  success: result.success,
                  message: "Memory added",
                  id: result.data?.id,
                });
              }

              case "search": {
                if (!args.query) return JSON.stringify({ success: false, error: "query required" });
                const res = await remoteMemoryClient.searchMemories(
                  args.query,
                  tags.project.tag,
                  args.scope ?? CLIENT_CONFIG.memory.defaultScope
                );
                return JSON.stringify({
                  success: res.success,
                  query: args.query,
                  count: res.results.length,
                  results: res.results.slice(0, args.limit || 10).map((r: any) => ({
                    id: r.id,
                    content: r.memory || r.chunk,
                    similarity: Math.round((r.similarity || 0) * 100),
                  })),
                });
              }

              case "profile": {
                const profileRes = await remoteMemoryClient.getUserProfile(
                  tags.user.userEmail || undefined
                );
                return JSON.stringify({ success: true, profile: profileRes.data ?? null });
              }

              case "list": {
                const res = await remoteMemoryClient.listMemories(
                  tags.project.tag,
                  args.limit || 20,
                  args.scope ?? CLIENT_CONFIG.memory.defaultScope
                );
                return JSON.stringify({
                  success: res.success,
                  count: res.memories.length,
                  memories: res.memories.map((m: any) => ({
                    id: m.id,
                    content: m.summary,
                    createdAt: m.createdAt,
                  })),
                });
              }

              case "forget": {
                if (!args.memoryId)
                  return JSON.stringify({ success: false, error: "memoryId required" });
                const res = await remoteMemoryClient.deleteMemory(args.memoryId);
                return JSON.stringify({ success: res.success, message: "Memory removed" });
              }

              default:
                return JSON.stringify({ success: false, error: `Unknown mode: ${mode}` });
            }
          } catch (error) {
            return JSON.stringify({ success: false, error: String(error) });
          }
        },
      }),
    },

    event: async (input: { event: { type: string; properties?: any } }) => {
      const event = input.event;
      logDebug(`event received`, { type: event.type, hasProperties: !!event.properties });

      if (event.type === "session.idle") {
        if (!isClientConfigured() || !CLIENT_CONFIG.autoCaptureEnabled) return;
        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;
        logDebug("session.idle event", { sessionId: sessionID, autoCaptureEnabled: CLIENT_CONFIG.autoCaptureEnabled });

        if (idleTimeout) clearTimeout(idleTimeout);
        if (captureInProgress) return;

        idleTimeout = setTimeout(async () => {
          captureInProgress = true;
          try {
            const messagesResponse = await ctx.client.session.messages({ path: { id: sessionID } });
            const messages = messagesResponse.data || [];
            const userMessages = messages.filter((m: any) => m.info.role === "user");
            const lastUserMsg = userMessages[userMessages.length - 1];
            if (!lastUserMsg) return;

            const userPrompt = lastUserMsg.parts
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("\n");

            const result = await remoteMemoryClient.autoCapture({
              sessionID,
              projectTag: tags.project.tag,
              projectMetadata: {
                displayName: tags.project.displayName,
                userName: tags.project.userName,
                userEmail: tags.project.userEmail,
                projectPath: tags.project.projectPath,
                projectName: tags.project.projectName,
                gitRepoUrl: tags.project.gitRepoUrl,
              },
              conversationMessages: messages.map((m: any) => ({
                role: m.info.role,
                parts: m.parts,
              })),
              userPrompt,
              promptMessageId: lastUserMsg.info.id,
            });
            if (result.success && result.data?.captured && CLIENT_CONFIG.showAutoCaptureToasts) {
              ctx.client?.tui
                .showToast({
                  body: {
                    title: "Memory Captured",
                    message: "Project memory saved from conversation",
                    variant: "success",
                    duration: 3000,
                  },
                })
                .catch(() => {});
              logDebug("Auto-capture completed", {
                 sessionId: sessionID,
                 success: result.success,
                 captured: result.data?.captured,
                 memoryId: result.data?.memoryId,
               });
            }
          } catch (error) {
            logError("Idle auto-capture error", { error: String(error) });
          } finally {
            idleTimeout = null;
            captureInProgress = false;
          }
        }, 10000);
      }

      if (event.type === "session.compacted") {
        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;
        logDebug("session.compacted event", { 
          sessionId: sessionID, 
          projectTag: tags.project.tag 
        });
        try {
          const memoriesResult = await remoteMemoryClient.searchMemoriesBySessionID(
            sessionID,
            tags.project.tag,
            10
          );
          if (!memoriesResult.success || memoriesResult.results.length === 0) return;
          let output = `## Restored Session Memory\n\n`;
          memoriesResult.results.forEach((m: any, i: number) => {
            if (m.memory == null) return;
            output += `### Memory ${i + 1}\n${m.memory}\n\n`;
            if (m.tags && m.tags.length > 0) output += `Tags: ${m.tags.join(", ")}\n\n`;
          });
          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              parts: [{ id: `prt-compaction-${Date.now()}`, type: "text", text: output }],
              noReply: true,
            },
          });
        } catch (error) {
          logError("Compaction handler error", { error: String(error) });
        }
      }
    },
  };
};
