# src/services/ai/

## Responsibility

Provides the AI provider abstraction layer: manages LLM interactions via two paths — (1) direct HTTP calls to OpenAI-compatible chat completion endpoints, and (2) structured output generation via the opencode v2 SDK. Handles provider instantiation, configuration, session persistence, tool-call loops, and response validation.

## Design

**Two AI access strategies coexist:**

1. **Provider pattern** (`providers/`) — An abstract `BaseAIProvider` with `executeToolCall()` for iterative tool-call loops. Currently one concrete implementation: `OpenAIChatCompletionProvider`, which sends chat completion requests with function-calling, loops until the model invokes the expected tool, and persists full message history via `AISessionRepository`.

2. **opencode SDK path** (`opencode-provider.ts`) — Generates structured JSON output by creating transient opencode v2 sessions, prompting with a Zod-derived JSON schema, then deleting the session. Bypasses direct HTTP/auth entirely by delegating to the running opencode server.

**Key abstractions:**

- `AIProviderFactory` — Static factory selecting the right provider by type string.
- `ProviderConfig` — Normalized config (model, URL, key, temperature, extra params, iteration limits).
- `buildMemoryProviderConfig()` — Merges runtime config from user settings into a `ProviderConfig`.
- `ChatCompletionTool` — TypeScript interface for OpenAI-style function-calling tool schemas.
- `UserProfileValidator` — Validates tool-call responses against the `UserProfileData` contract.

## Flow

**Provider (tool-call) path:**

1. Caller gets a provider via `AIProviderFactory.createProvider(type, config)`.
2. Calls `executeToolCall(systemPrompt, userPrompt, toolSchema, sessionId)`.
3. Provider creates/resumes an AI session in storage, replays prior messages, appends new system+user messages.
4. Iterative loop: POST to `/chat/completions`, parse response, check for target tool invocation.
5. On correct tool call: parse args, validate (`UserProfileValidator` for profile tools), return data.
6. On wrong/missing tool call: append corrective message, retry (up to `maxIterations`, default 5).
7. All messages persisted to `AISessionRepository` for session continuity.

**opencode SDK (structured output) path:**

1. Caller provides a Zod schema, system/user prompts, and provider/model IDs.
2. `generateStructuredOutput()` converts schema to JSON Schema via Zod v4.
3. Creates a transient opencode session, sends a `json_schema`-formatted prompt.
4. Parses `info.structured` through Zod validation, returns typed result.
5. Deletes the transient session in a `finally` block (best-effort cleanup).

## Integration

- **`src/services/storage/`** — `AIProviderFactory` creates an `AISessionRepository` via `createAISessionRepository()`. `OpenAIChatCompletionProvider` uses it to persist sessions and messages across tool-call iterations.
- **`src/services/user-profile/types.js`** — `UserProfileValidator` validates tool-call results as `UserProfileData`.
- **`@opencode-ai/sdk`** — `opencode-provider.ts` uses the v2 client for structured output; caller must initialize via `setV2Client()` / `createV2Client()`.
- **`src/services/logger.js`** — `OpenAIChatCompletionProvider` logs errors and debug info.
