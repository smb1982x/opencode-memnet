# src/services/ai/providers/

## Responsibility

Adapt AI provider API calls into a uniform tool-calling contract for memory extraction. Each provider wraps a specific LLM vendor API (OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, Google Gemini) behind the shared `BaseAIProvider` abstract class. The folder's single job: **translate a system prompt + user prompt + tool schema into a validated tool call result** (`ToolCallResult`), regardless of which backend is in use.

The callers (memory-extraction orchestration) interact only with `BaseAIProvider.executeToolCall()`. This isolates all vendor-specific HTTP formatting, auth, retry logic, error mapping, and response parsing behind a polymorphic boundary.

## Design Patterns

| Pattern | Usage |
|---|---|
| **Abstract Base (Template Method)** | `BaseAIProvider` defines the interface (`executeToolCall`, `getProviderName`, `supportsSession`). Each provider implements the full body of `executeToolCall`. |
| **Strategy** | Providers are interchangeable at runtime. The caller selects a provider by config; all expose the same async `executeToolCall(...)` signature. |
| **Adapter** | Each provider adapts a common internal schema (`ChatCompletionTool`, `AIMessage`) into the vendor's wire format. `ToolSchemaConverter` formalises this for Anthropic and OpenAI Responses formats. |
| **Constructor Injection** | Every concrete provider receives `AISessionManager` (and its own `ProviderConfig`) through the constructor. No service locator or global state. |
| **Iteration with AbortController** | All providers loop up to `maxIterations` (default 5) with a per-iteration `AbortController` timeout. The loop retries the LLM when it responds without a tool call, injecting a retry prompt. |
| **Safe Extra Params (Filtered Passthrough)** | `applySafeExtraParams()` deep-merges user-supplied `extraParams` into the request body while blocking keys that would conflict (`model`, `messages`, `tools`, `tool_choice`, `temperature`, `input`, `instructions`, `conversation`). |

### Provider matrix

| Provider | Class | API endpoint | Session model | Schema conversion | Auth header |
|---|---|---|---|---|---|
| OpenAI Chat Completions | `OpenAIChatCompletionProvider` | `/chat/completions` | Message list (persisted in SQLite) | Native `ChatCompletionTool` | `Authorization: Bearer <key>` |
| OpenAI Responses | `OpenAIResponsesProvider` | `/responses` | Conversation ID (stateful server-side) | `ToolSchemaConverter.toResponsesAPI()` | `Authorization: Bearer <key>` |
| Anthropic Messages | `AnthropicMessagesProvider` | `/messages` | Message list (persisted in SQLite) | `ToolSchemaConverter.toAnthropic()` | `x-api-key: <key>` |
| Google Gemini | `GoogleGeminiProvider` | `/models/{model}:generateContent` | Message list (persisted in SQLite) | Inline `functionDeclarations` | API key as query param `?key=` |

### Key abstractions

- **`BaseAIProvider`** (`base-provider.ts`): Abstract class with `config: ProviderConfig` and three abstract methods. Also exports `ToolCallResult`, `ProviderConfig`, and `applySafeExtraParams()`.
- **`ProviderConfig`**: Model name, API URL, optional key, max iterations, timeout, max tokens, temperature flag, extra params blob.
- **`ToolCallResult`**: `{ success, data?, error?, iterations? }` — the uniform return type consumed by memory extraction logic.
- **`UserProfileValidator`**: Shared validation gate used by OpenAI Chat, Anthropic, and Gemini providers to verify tool-call arguments before accepting them.
- **`AISessionManager`**: Persists sessions and messages to `ai-sessions.db` (SQLite). All providers use it for message history, sequence numbering, and session lifecycle.

## Data & Control Flow

### High-level flow (all providers)

```
Caller (memory extraction)
  │
  ├─ executeToolCall(systemPrompt, userPrompt, toolSchema, sessionId)
  │
  ▼
  session lookup / creation (AISessionManager)
  │
  ▼
  load existing messages → convert to vendor format
  │
  ▼
  append userPrompt
  │
  ▼
  LOOP (maxIterations):
  │   │
  │   ├─ POST to vendor API (AbortController for timeout)
  │   ├─ persist assistant response to DB
  │   │
  │   ├─ tool call found AND matches expected name?
  │   │   ├─ YES → UserProfileValidator.validate(args)
  │   │   │         ├─ valid    → return { success: true, data }
  │   │   │         └─ invalid  → return { success: false, error }
  │   │   │
  │   │   └─ NO  → push retry prompt → continue loop
  │   │
  │   └─ error / abort → return { success: false, error }
  │
  └─ max iterations exhausted → return { success: false, error }
```

### Provider-specific divergences

#### OpenAI Chat Completions (`openai-chat-completion.ts`)

1. **Message filtering**: `filterIncompleteToolCallSequences()` strips orphaned tool-call/response pairs so only complete sequences are sent. This prevents sending dangling tool IDs on retries.
2. **Temperature guard**: Catches HTTP 400 with `"unsupported_value"` for `temperature` and returns a user-friendly message suggesting `memoryTemperature: false`.
3. **Tool response**: Uses `addToolResponse()` which persists the tool result to DB *and* pushes an `APIMessage` with `role: "tool"` and `tool_call_id` into the in-memory array.
4. **Wrong-tool guard**: If the LLM calls a tool whose name doesn't match `toolSchema.function.name`, it returns an error response telling the model which tool to use and breaks the loop.

#### Anthropic Messages (`anthropic-messages.ts`)

1. **Separate system prompt**: Sent in the top-level `system` field instead of as a `system`-role message.
2. **Content blocks**: Stores `data.content` (array of content blocks) as `contentBlocks` on the persisted `AIMessage`. When reconstructing messages for subsequent calls, it uses `msg.contentBlocks || msg.content`.
3. **Tool use extraction**: `extractToolUse()` iterates response content blocks looking for `type: "tool_use"` matching the expected tool name. Returns `block.input` directly.
4. **Stop reason branching**: On `"end_turn"` (model finished speaking without calling a tool) it pushes a retry prompt. Otherwise breaks the loop (model may have refused or given a final answer).

#### Google Gemini (`google-gemini.ts`)

1. **API key in URL**: `?key=${this.config.apiKey}` appended to the URL (Google AI Studio pattern).
2. **Forced function calling**: `toolConfig.functionCallingConfig.mode: "ANY"` + `allowedFunctionNames` — Gemini must call the tool.
3. **Role mapping**: `assistant` → `"model"`, `user` → `"user"`, `tool` → `"function"`.
4. **Function call format**: Gemini returns `part.functionCall` (name + args) rather than a `tool_calls` array. The provider normalises these into the common `toolCalls` shape with a synthetic `id`.
5. **Tool response format**: Pushed as `{ role: "function", parts: [{ functionResponse: { name, response } }] }`.
6. **System instruction**: Separate `systemInstruction.parts[0].text` field at the top level of the request body.

#### OpenAI Responses (`openai-responses.ts`)

1. **Conversation-based state**: Uses the Responses API's built-in conversation ID. The `conversationId` is extracted from the first response and stored in the session's `conversationId` field. Subsequent calls send `conversation` instead of `instructions` (system prompt only sent on first call).
2. **No local message replay**: Unlike the other providers, it does not rebuild the full message list on each iteration. Instead it relies on the server-side conversation state and sends only `currentPrompt` (user input).
3. **Prompt construction**: `buildRetryPrompt()` extracts the assistant's text from `data.output` and prepends it to a retry instruction.
4. **Tool call extraction**: `extractToolCall()` looks for `output` items with `type: "function_call"` matching the expected name, then parses `arguments` JSON.
5. **Response validation**: `validateResponse()` runs a structural check (non-array, non-empty, no null values) before returning the parsed tool data.
6. **Session update**: After a successful tool call, it persists the `conversationId` back to the session via `aiSessionManager.updateSession()`.

### Data structures

| Type | File | Role |
|---|---|---|
| `ProviderConfig` | `base-provider.ts` | Per-provider static config (model, URL, auth, limits) |
| `ToolCallResult` | `base-provider.ts` | Return value of `executeToolCall` |
| `AIMessage` | `session/session-types.ts` | Canonical message shape persisted in SQLite |
| `AISession` | `session/session-types.ts` | Session row shape (id, provider, sessionId, conversationId, timestamps) |
| `ChatCompletionTool` | `tools/tool-schema.ts` | Canonical tool definition (OpenAI Chat format) |
| `AnthropicTool` / `ResponsesAPITool` | `tools/tool-schema.ts` | Vendor-specific tool definitions, converted by `ToolSchemaConverter` |

## Integration Points

### Inbound (who calls these providers)

- **Memory extraction orchestrator** (likely in `src/services/ai/`): Creates a `BaseAIProvider` instance (selected by config), calls `executeToolCall()`, and consumes `ToolCallResult`. The orchestrator does not import concrete provider classes directly — it depends on the abstract type or a factory.

### Outbound (what providers call)

| Dependency | Direction | Details |
|---|---|---|
| **`AISessionManager`** | Used by all 4 providers | Session CRUD, message persistence, sequence numbering. Backed by `ai-sessions.db` (SQLite via `better-sqlite3`). |
| **`UserProfileValidator`** | Used by OpenAI Chat, Anthropic, Gemini | `validate(parsedToolArgs)` returns `{ valid, data, errors }`. Shared validation for extracted memory data. |
| **`ToolSchemaConverter`** | Used by Anthropic, OpenAI Responses | Static methods `toAnthropic()` and `toResponsesAPI()` convert canonical `ChatCompletionTool` to vendor formats. |
| **`log()`** (logger) | Used by all 4 providers | Structured logging for API errors, validation failures, iteration state. |
| **`fetch()`** (global) | Used by all 4 providers | HTTP POST to vendor API endpoints. |

### Provider selection / factory

Providers are instantiated with `new XxxProvider(config, aiSessionManager)`. The calling code selects the provider class based on a configuration string (e.g. `"openai-chat"`, `"anthropic"`). A factory function (not in this folder) maps config values to constructors. The `ProviderConfig.model` and `ProviderConfig.apiUrl` values are passed through from higher-level config.

### Session lifecycle

1. **First call**: Provider calls `aiSessionManager.getSession(sessionId, providerName)` → returns null → calls `createSession()`.
2. **Subsequent calls**: `getSession()` finds the existing session (filtered by `expires_at`), and the provider loads messages via `getMessages(session.id)`.
3. **Cleanup**: `AISessionManager.cleanupExpiredSessions()` is invoked externally on a timer or at startup to purge rows past `sessionRetentionMs`.

### Error propagation

All errors are surfaced through `ToolCallResult`:
- **API errors** (HTTP status, malformed responses) → `{ success: false, error: "API error: 4xx - ..." }`
- **Validation failures** (tool arguments don't pass `UserProfileValidator`) → `{ success: false, error: "Validation failed: ..." }`
- **Timeout** (AbortError from iteration timeout) → `{ success: false, error: "API request timeout (30000ms)" }`
- **Max iterations** (LLM never called the expected tool) → `{ success: false, error: "Max iterations (5) reached without tool call" }`

No exceptions escape `executeToolCall()`; all paths are caught and converted to structured error results.
