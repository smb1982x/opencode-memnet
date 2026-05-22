# src/services/ai/

## Responsibility

This folder provides the **AI provider abstraction layer** — a unified interface for
interacting with multiple large language model (LLM) providers. It is responsible for:

1. **Provider factory / registry** — creating the correct provider instance based on
   a runtime type string (`openai-chat`, `openai-responses`, `anthropic`, `google-gemini`).
2. **Multi-turn conversation sessions** — persisting chat history in SQLite so the
   same logical "session" can be resumed across tool-call iterations.
3. **Tool‑oriented LLM calls** — each provider implementation sends a system prompt,
   user prompt, and a tool/function schema to its respective API, then extracts and
   validates the structured result.
4. **Structured output via opencode SDK** — `opencode-provider.ts` delegates to the
   running opencode server so it handles auth, token refresh, and provider routing
   for any provider the user has configured in their opencode profile.
5. **Response validation** — parsed tool-call arguments are validated against the
   expected `UserProfileData` shape before being accepted.

## Design Patterns

| Pattern | Where | Purpose |
|---|---|---|
| **Abstract Factory** | `AIProviderFactory.createProvider()` | Maps a `AIProviderType` string to a concrete `BaseAIProvider` subclass. |
| **Template Method** | `BaseAIProvider` → `OpenAIChatCompletionProvider` / `OpenAIResponsesProvider` / `AnthropicMessagesProvider` / `GoogleGeminiProvider` | Subclasses implement `executeToolCall()` and `getProviderName()`; the base provides `applySafeExtraParams()`. |
| **Singleton** | `aiSessionManager` (exported instance of `AISessionManager`) | Single SQLite-backed session store shared across all providers. |
| **Adapter** | `ToolSchemaConverter` | Normalises the internal `ChatCompletionTool` shape into provider-specific formats (OpenAI Responses API `ResponsesAPITool`, Anthropic `AnthropicTool`). |
| **Facade** | `opencode-provider.ts` | Wraps the `@opencode-ai/sdk/v2` client behind simple functions (`generateStructuredOutput`, `setV2Client`, `createV2Client`). |
| **Retry / Iteration** | Each provider's `executeToolCall()` loop | Iterates up to `maxIterations` (default 5) with per-iteration `AbortController` timeout, re-prompting the model until it emits the expected tool call. |

### Provider factory / config / opencode provider responsibilities

| Module | Responsibility |
|---|---|
| `ai-provider-factory.ts` | Static factory that instantiates the correct `BaseAIProvider` given a `AIProviderType`. Also exposes `getSupportedProviders()` and `cleanupExpiredSessions()`. |
| `provider-config.ts` | Runtime config builder — `buildMemoryProviderConfig()` merges user-level config (`memoryModel`, `memoryApiUrl`, `memoryApiKey`, etc.) with per-call overrides (`maxIterations`, `iterationTimeout`) into a `ProviderConfig` object. |
| `opencode-provider.ts` | SDK-based structured output **outside** the factory. Creates a transient opencode v2 session, sends one prompt with a JSON schema, returns parsed + Zod-validated data, then deletes the session. Manages its own client instance and connected-provider set. |

## Data & Control Flow

### Direct provider flow (via AIProviderFactory)

```
Caller (e.g. memory capture service)
  │
  ▼
AIProviderFactory.createProvider("openai-chat", config)
  │
  ▼  [returns OpenAIChatCompletionProvider instance]
executeToolCall(systemPrompt, userPrompt, toolSchema, sessionId)
  │
  ├─ 1. Lookup / create AISession via aiSessionManager
  ├─ 2. Reconstruct message array from stored AIMessage rows
  ├─ 3. Append user prompt to session + message array
  │
  └─ [Retry loop, up to maxIterations]
       │
       ├─ 4. Build provider-specific HTTP request body
       │     (incl. safe extra params via applySafeExtraParams)
       ├─ 5. POST to provider API endpoint
       ├─ 6. Parse provider response
       ├─ 7. Extract tool call from response
       │     ├─ Found & validated  → return ToolCallResult { success: true, data }
       │     └─ Missing / invalid   → push retry prompt, continue loop
       └─ 8. On max iterations     → return ToolCallResult { success: false, error }
```

### opencode SDK flow

```
Caller
  │
  ▼
generateStructuredOutput({ client, providerID, modelID, systemPrompt, userPrompt, schema })
  │
  ├─ 1. Convert Zod schema → JSON Schema (via .toJSONSchema() or z.toJSONSchema())
  ├─ 2. client.session.create()   → transient session
  ├─ 3. client.session.prompt()   → format: json_schema, noReply: true
  ├─ 4. Extract info.structured from response
  ├─ 5. schema.parse()            → Zod validation
  ├─ 6. client.session.delete()   → cleanup (best-effort)
  └─ 7. Return parsed data
```

### Session lifecycle

```
createSession(params)
  │  INSERT INTO ai_sessions (id, provider, session_id, ...)
  │
  ▼
executeToolCall (per iteration)
  │  addMessage() → INSERT INTO ai_messages (ai_session_id, sequence, role, content, ...)
  │
  ▼
cleanupExpiredSessions()
  │  DELETE FROM ai_sessions WHERE expires_at < now
  │
  ▼
deleteSession() / clearMessages()  -- explicit teardown
```

## Integration Points

| Integration | Direction | Mechanism |
|---|---|---|
| **`../../logger.js`** (logging) | ai/ → logger | `log()` calls for API errors, validation failures, and iteration tracking in every provider. |
| **`../../sqlite/`** (database) | ai/session/ → sqlite | `AISessionManager` uses `connectionManager.getConnection()` and runs DDL/DML against `ai-sessions.db`. |
| **`../../../config.js`** (runtime config) | ai/session/ → config | `AISessionManager` reads `CONFIG.storagePath` and `CONFIG.aiSessionRetentionDays`. |
| **`../../user-profile/types.js`** (domain types) | ai/validators/ → user-profile | `UserProfileValidator.validate()` returns typed `UserProfileData`. |

### Nested folders

| Folder | Role (integration point, not internal detail) |
|---|---|
| **`providers/`** | Provider-specific API adapters. Each file maps the abstract `BaseAIProvider.executeToolCall()` contract to one vendor's HTTP API. `base-provider.ts` defines the contract (`ProviderConfig`, `ToolCallResult`, `applySafeExtraParams`). |
| **`session/`** | SQLite-backed persistence layer for multi-turn AI conversations. `AISessionManager` stores sessions and messages; `session-types.ts` defines the shared types (`AIProviderType`, `AIMessage`, `AISession`). |
| **`tools/`** | Schema normalization — `ToolSchemaConverter` translates the canonical `ChatCompletionTool` into provider-specific shapes (OpenAI Responses, Anthropic, etc.). |
| **`validators/`** | Response validation — `UserProfileValidator` checks parsed tool output against the expected `UserProfileData` structure (preferences, patterns, workflows with required fields and array constraints). |
