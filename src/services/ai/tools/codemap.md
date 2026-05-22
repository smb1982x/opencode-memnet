# src/services/ai/tools/

## Responsibility

Define the canonical tool schema contracts used across all AI provider integrations and provide adapters that convert between provider-native formats. This module owns the **single source of truth** for how function-calling tools are represented internally, insulating the rest of the system from per-provider schema differences.

**Key outputs:**
- `ChatCompletionTool` — internal canonical format (mirrors OpenAI Chat Completions `tools` parameter shape)
- `ToolSchemaConverter` — stateless adapter that converts the canonical form into `ResponsesAPITool` (OpenAI Responses API) or `AnthropicTool` (Anthropic Messages API)
- Google Gemini uses `ChatCompletionTool` properties directly (inlined `functionDeclarations`), so it reads the canonical form without a converter call.

## Design Patterns

| Pattern | Application |
|---|---|
| **Canonical Data Model** | `ChatCompletionTool` is the internal interchange format; all providers consume this and convert outbound only. |
| **Adapter / Converter** | `ToolSchemaConverter.toResponsesAPI()` and `ToolSchemaConverter.toAnthropic()` adapt the canonical shape to provider-native shapes. |
| **Stateless Utility Class** | `ToolSchemaConverter` has no instance state; all methods are `static`. |
| **Structural Typing (duck typing)** | Google Gemini (`google-gemini.ts`) reads properties directly from `ChatCompletionTool.function` without calling any converter — the shape of `functionDeclarations[0]` happens to align with the canonical format. |

**Interface hierarchy:**

```
ChatCompletionTool  (canonical internal)
  ├── used directly by OpenAIChatCompletionProvider
  ├── used directly by GoogleGeminiProvider (reads .function.name / .description / .parameters)
  ├── → ToolSchemaConverter.toResponsesAPI()  →  ResponsesAPITool  (OpenAI Responses)
  └── → ToolSchemaConverter.toAnthropic()     →  AnthropicTool      (Anthropic Messages)
```

**Why `ChatCompletionTool` is the canonical form:**
- It mirrors the most widely-adopted tool schema (OpenAI Chat Completions)
- All four providers accept it as the `toolSchema` parameter of `executeToolCall()`
- Only two providers require conversion (OpenAI Responses, Anthropic); the rest consume it as-is

## Data & Control Flow

### 1. Canonical schema definition (`tool-schema.ts`)

```
ChatCompletionTool
  type: "function"
  function:
    name: string
    description: string
    parameters: { type, properties, required }

ResponsesAPITool
  type: "function"
  name: string
  description: string
  parameters: { type, properties, required }
  // Note: flatter structure — `name`/`description` are top-level, not nested under `function`

AnthropicTool
  name: string
  description: string
  input_schema: { type, properties, required }
  // Note: uses `input_schema` instead of `parameters`
```

### 2. Conversion flow

```
                    ToolSchemaConverter
                           │
     ┌─────────────────────┼─────────────────────┐
     │                     │                     │
  toResponsesAPI()    toAnthropic()      fromChatCompletion()
     │                     │                     │
     ▼                     ▼                     ▼
ResponsesAPITool     AnthropicTool        { chatCompletion,
     │                     │                responsesAPI,
     │                     │                anthropic }
  (used by              (used by
   openai-                anthropic-
   responses.ts)          messages.ts)
```

### 3. Provider integration flow

Each provider's `executeToolCall(systemPrompt, userPrompt, toolSchema, sessionId)` receives `toolSchema: ChatCompletionTool` and is responsible for converting it to the provider's native wire format before sending the HTTP request.

```
AIProviderFactory.createProvider()
  │
  ├── OpenAIChatCompletionProvider
  │     toolSchema → used directly in requestBody.tools[]
  │     POST {apiUrl}/chat/completions
  │
  ├── OpenAIResponsesProvider
  │     toolSchema → ToolSchemaConverter.toResponsesAPI()
  │     POST {apiUrl}/responses
  │
  ├── AnthropicMessagesProvider
  │     toolSchema → ToolSchemaConverter.toAnthropic()
  │     POST {apiUrl}/messages
  │
  └── GoogleGeminiProvider
        toolSchema → maps .function.name/description/parameters
                      into tools[0].functionDeclarations[0]
        POST {apiUrl}/models/{model}:generateContent
```

### 4. Alternate path: SDK-based structured output (`opencode-provider.ts`)

The `generateStructuredOutput()` function in `opencode-provider.ts` bypasses the tool schema system entirely. Instead of function-calling tool schemas, it uses **Zod-to-JSON-Schema** conversion and sends a `json_schema` format constraint via the opencode v2 SDK:

```
Zod schema → toJSONSchema() → JSON Schema → client.session.prompt(format: { type: "json_schema", schema })
```

This path is SDK-mediated (not direct HTTP) and does not rely on `ChatCompletionTool` or `ToolSchemaConverter`.

## Integration Points

### Consumers of `tool-schema.ts`

| File | Import | Usage |
|---|---|---|
| `providers/openai-chat-completion.ts` | `type { ChatCompletionTool }` | `toolSchema` param type; inserted directly into request body |
| `providers/openai-responses.ts` | `{ ToolSchemaConverter, type ChatCompletionTool }` | Converts via `toResponsesAPI()` before sending |
| `providers/anthropic-messages.ts` | `{ ToolSchemaConverter, type ChatCompletionTool }` | Converts via `toAnthropic()` before sending |
| `providers/google-gemini.ts` | `type { ChatCompletionTool }` | Reads `toolSchema.function.*` properties directly; inlines into `functionDeclarations` |

### Producer of `ChatCompletionTool`

The canonical `ChatCompletionTool` objects are created at the call sites that invoke `executeToolCall()` — typically in memory-extraction or tool-calling orchestration code outside this directory. The tools module provides the **type contract** and **conversion utilities** but does not itself instantiate tool schemas.

### Upstream dependencies

| Dependency | Used By | Why |
|---|---|---|
| `BaseAIProvider` (in `providers/base-provider.ts`) | All providers | Base class defining `executeToolCall` signature; `ToolCallResult` return type |
| `AISessionManager` (in `session/`) | All providers | Session/state persistence across tool-call iterations |
| `UserProfileValidator` (in `validators/`) | OpenAI Chat, Anthropic, Gemini | Validates tool-call arguments before returning success |
| `log` (in `logger.ts`) | All providers | Error/retry logging |
| `applySafeExtraParams` (in `base-provider.ts`) | OpenAI Chat, OpenAI Responses | Merges user-configured extra params while protecting known keys |

### Downstream impact

If a new provider is added:
1. A new provider class extends `BaseAIProvider`
2. Its `executeToolCall` receives `toolSchema: ChatCompletionTool`
3. If the provider's native tool format differs from OpenAI Chat Completions, add a new converter method to `ToolSchemaConverter`
4. Register the provider in `AIProviderFactory.createProvider()`

If the canonical `ChatCompletionTool` shape changes (e.g., a new field), only the converter methods in `ToolSchemaConverter` and the provider-specific request-body construction need updates — the rest of the system is shielded.
