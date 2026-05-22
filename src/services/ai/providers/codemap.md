# src/services/ai/providers/

## Responsibility

Implements the AI provider abstraction layer — a strategy pattern for calling different LLM APIs. Each concrete provider handles prompt construction, API communication, tool-call parsing, response validation, and session persistence for one API family.

## Design

- **`BaseAIProvider`** (abstract class) — defines the contract: `executeToolCall()`, `getProviderName()`, `supportsSession()`. Holds a shared `ProviderConfig` (model, URL, key, temperature, extra params, iteration limits).
- **`ProviderConfig`** — typed config object consumed by all providers.
- **`ToolCallResult`** — uniform return type (`success`, `data`, `error`, `iterations`).
- **`applySafeExtraParams()`** — merges user-supplied extra parameters into the request body while blocking protected keys (`model`, `messages`, `tools`, `temperature`, etc.).
- **`OpenAIChatCompletionProvider`** — the only concrete implementation. Wraps the OpenAI `/chat/completions` endpoint with multi-turn tool-call loops and session persistence.

## Flow

1. Caller invokes `executeToolCall(systemPrompt, userPrompt, toolSchema, sessionId)`.
2. Provider loads (or creates) a session from `AISessionRepository`.
3. Historical messages are loaded, filtered for incomplete tool-call sequences, and rebuilt into an API message array.
4. On the first call the system prompt is prepended; the user prompt is appended.
5. A **bounded iteration loop** (default 5, configurable) sends requests to the API:
   - Builds the request body; applies safe extra params.
   - Sends `POST /chat/completions` with `tool_choice: "auto"`.
   - On success: persists the assistant message (including tool_calls) to the session repo.
   - If the expected tool is called → parses arguments, validates (via `UserProfileValidator` for profile tools), returns `ToolCallResult`.
   - If the wrong tool or no tool is called → appends a retry prompt and loops.
   - On API error / timeout / max iterations → returns a failed `ToolCallResult`.

## Integration

- **`../../storage/types`** (`AISessionRepository`, `AIMessageRow`) — session and message persistence.
- **`../tools/tool-schema`** (`ChatCompletionTool`) — tool schema definition passed to the API.
- **`../validators/user-profile-validator`** — validates structured output for profile-related tools.
- **`../../logger`** — structured logging for errors and debugging.
- Consumers instantiate a provider via config and call `executeToolCall()` polymorphically through the `BaseAIProvider` interface.
