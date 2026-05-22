# src/services/ai/tools/

## Responsibility

Defines the shared type schema for AI tool definitions (function-calling / tool-use). This directory provides the `ChatCompletionTool` interface that describes how tools are declared when sending requests to LLM providers.

## Design

- **Single type module**: `tool-schema.ts` exports one interface — `ChatCompletionTool` — modeled after the OpenAI chat-completion tool format.
- The interface follows the standard `{ type: "function", function: { name, description, parameters } }` structure with `parameters` containing JSON Schema–style `type`, `properties`, and `required` fields.
- Kept in its own directory to serve as a shared contract between tool definitions and provider implementations, independent of any single provider.

## Flow

1. Callers construct `ChatCompletionTool[]` arrays describing available tools.
2. The array is passed into the provider's request body (`tools` field).
3. The provider sends the tool schema to the LLM; the LLM may respond with tool calls that are then executed via `executeToolCall`.

## Integration

- **Consumer**: `src/services/ai/providers/openai-chat-completion.ts` — imports `ChatCompletionTool` and uses it in both the `RequestBody` type (line 39) and the `executeToolCall` method signature (line 152).
- **Future**: Any additional provider that supports function-calling should import from this shared schema rather than defining its own tool type.
