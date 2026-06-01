// src/services/auto-capture-server.ts
// Server-side auto-capture: AI provider calls without OpenCode plugin dependency

import { CONFIG } from "../config.js";
import { log } from "./logger.js";

export async function generateSummary(
  context: string,
  sessionID: string,
  userPrompt: string
): Promise<{ summary: string; type: string; tags: string[] } | null> {
  if (!CONFIG.memoryModel || !CONFIG.memoryApiUrl) {
    throw new Error(
      "Server requires memoryModel and memoryApiUrl for auto-capture. Configure these in opencode-memnet.jsonc."
    );
  }

  const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");
  const { detectLanguage, getLanguageName } = await import("./language-detector.js");

  const providerConfig = buildMemoryProviderConfig(CONFIG as any);
  const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);

  const targetLang =
    CONFIG.autoCaptureLanguage === "auto" || !CONFIG.autoCaptureLanguage
      ? detectLanguage(userPrompt)
      : CONFIG.autoCaptureLanguage;
  const langName = getLanguageName(targetLang);

  const systemPrompt = `You are a technical memory recorder for a software development project.

RULES:
1. ONLY capture technical work (code, bugs, features, architecture, config)
2. SKIP non-technical by returning type="skip"
3. NO meta-commentary or behavior analysis
4. Include specific file names, functions, technical details
5. You MUST write the summary in ${langName}.

TAG RULES:
- Generate 2-4 concise, lowercase, hyphenated technical tags
- Prefer stable nouns, technology names, system components
- Avoid verbs, gerunds, arbitrary abbreviations
- Examples: "react", "auth", "bug-fix", "docker", "api-design"

FORMAT:
## Request
[1-2 sentences: what was requested, in ${langName}]

## Outcome
[1-2 sentences: what was done, include files/functions, in ${langName}]

SKIP if: greetings, casual chat, no code/decisions made
CAPTURE if: code changed, bug fixed, feature added, decision made`;

  const aiPrompt = `${context}

Analyze this conversation. If it contains technical work (code, bugs, features, decisions), create a concise summary and relevant tags. If it's non-technical (greetings, casual chat, incomplete requests), return type="skip" with empty summary.`;

  const toolSchema = {
    type: "function" as const,
    function: {
      name: "save_memory",
      description: "Save the conversation summary as a memory",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Markdown-formatted summary" },
          type: {
            type: "string",
            description: "Type: 'skip' for non-technical, or technical type",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "2-4 technical tags",
          },
        },
        required: ["summary", "type", "tags"],
      },
    },
  };

  const result = await provider.executeToolCall(systemPrompt, aiPrompt, toolSchema, sessionID);

  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to generate summary");
  }

  return {
    summary: result.data.summary,
    type: result.data.type,
    tags: (result.data.tags || []).map((t: string) => t.toLowerCase().trim()),
  };
}
