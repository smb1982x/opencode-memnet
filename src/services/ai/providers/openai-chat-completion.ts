import {
  BaseAIProvider,
  type ProviderConfig,
  type ToolCallResult,
  applySafeExtraParams,
} from "./base-provider.js";
import type { AISessionRepository, AIMessageRow } from "../../storage/types.js";
import type { ChatCompletionTool } from "../tools/tool-schema.js";
import { log } from "../../logger.js";
import { UserProfileValidator } from "../validators/user-profile-validator.js";

interface ToolCallResponse {
  choices: Array<{
    message: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
}

type APIMessage = {
  role: AIMessageRow["role"];
  content: string | null;
  tool_calls?: ToolCallResponse["choices"][number]["message"]["tool_calls"];
  tool_call_id?: string;
};

type RequestBody = {
  model: string;
  messages: APIMessage[];
  tools: ChatCompletionTool[];
  tool_choice: "auto";
  temperature?: number;
  [key: string]: unknown;
};

type AssistantSessionMessage = Omit<AIMessageRow, "id" | "createdAt">;

function isErrorResponseBody(data: unknown): data is { status: string; msg: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as { status?: unknown }).status === "string" &&
    typeof (data as { msg?: unknown }).msg === "string"
  );
}

function hasNonEmptyChoices(data: unknown): data is ToolCallResponse {
  if (typeof data !== "object" || data === null) return false;
  const { choices } = data as { choices?: unknown };
  if (!Array.isArray(choices) || choices.length === 0) return false;

  const first = choices[0] as { message?: unknown };
  if (typeof first !== "object" || first === null) return false;
  if (typeof first.message !== "object" || first.message === null) return false;

  const { content, tool_calls } = first.message as { content?: unknown; tool_calls?: unknown };
  if (content !== undefined && content !== null && typeof content !== "string") return false;
  if (tool_calls !== undefined && !Array.isArray(tool_calls)) return false;

  return true;
}

export class OpenAIChatCompletionProvider extends BaseAIProvider {
  private readonly sessionRepo: AISessionRepository;

  constructor(config: ProviderConfig, sessionRepo: AISessionRepository) {
    super(config);
    this.sessionRepo = sessionRepo;
  }

  getProviderName(): string {
    return "openai-chat";
  }

  supportsSession(): boolean {
    return true;
  }

  private async addToolResponse(
    sessionId: string,
    messages: APIMessage[],
    toolCallId: string,
    content: string
  ): Promise<void> {
    const sequence = ((await this.sessionRepo.getLastSequence(sessionId)) ?? 0) + 1;
    await this.sessionRepo.addMessage({
      aiSessionId: sessionId,
      sequence,
      role: "tool",
      content,
      toolCallId,
    });
    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content,
    });
  }

  protected filterIncompleteToolCallSequences(messages: AIMessageRow[]): AIMessageRow[] {
    const result: AIMessageRow[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];
      if (!msg) {
        break;
      }

      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        const toolCallIds = new Set(msg.toolCalls.map((tc: any) => tc.id));
        const toolResponses: AIMessageRow[] = [];
        let j = i + 1;

        while (j < messages.length && messages[j]?.role === "tool") {
          const toolMessage = messages[j];
          if (toolMessage?.toolCallId && toolCallIds.has(toolMessage.toolCallId)) {
            toolResponses.push(toolMessage);
            toolCallIds.delete(toolMessage.toolCallId);
          }
          j++;
        }

        if (toolCallIds.size === 0) {
          result.push(msg);
          toolResponses.forEach((tr) => result.push(tr));
          i = j;
        } else {
          break;
        }
      } else {
        result.push(msg);
        i++;
      }
    }

    return result;
  }

  async executeToolCall(
    systemPrompt: string,
    userPrompt: string,
    toolSchema: ChatCompletionTool,
    sessionId: string
  ): Promise<ToolCallResult> {
    let session = await this.sessionRepo.getSession(sessionId, "openai-chat");

    if (!session) {
      try {
        session = await this.sessionRepo.createSession({
          provider: "openai-chat",
          sessionId,
        });
      } catch (err) {
        // Session might have been created by a concurrent call — try fetching again
        const existing = await this.sessionRepo.getSession(sessionId, "openai-chat");
        if (existing) {
          session = existing;
        } else {
          throw err;
        }
      }
    }

    const existingMessages = await this.sessionRepo.getMessages(session.id);
    const messages: APIMessage[] = [];

    const validatedMessages = this.filterIncompleteToolCallSequences(existingMessages);

    for (const msg of validatedMessages) {
      const apiMsg: APIMessage = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.toolCalls) {
        apiMsg.tool_calls = msg.toolCalls;
      }

      if (msg.toolCallId) {
        apiMsg.tool_call_id = msg.toolCallId;
      }

      messages.push(apiMsg);
    }

    if (messages.length === 0) {
      const sequence = ((await this.sessionRepo.getLastSequence(session.id)) ?? 0) + 1;
      await this.sessionRepo.addMessage({
        aiSessionId: session.id,
        sequence,
        role: "system",
        content: systemPrompt,
      });

      messages.push({ role: "system", content: systemPrompt });
    }

    const userSequence = ((await this.sessionRepo.getLastSequence(session.id)) ?? 0) + 1;
    await this.sessionRepo.addMessage({
      aiSessionId: session.id,
      sequence: userSequence,
      role: "user",
      content: userPrompt,
    });

    messages.push({ role: "user", content: userPrompt });

    let iterations = 0;
    const maxIterations = this.config.maxIterations ?? 5;
    const iterationTimeout = this.config.iterationTimeout ?? 30000;

    while (iterations < maxIterations) {
      iterations++;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), iterationTimeout);

      try {
        const requestBody: RequestBody = {
          model: this.config.model,
          messages,
          tools: [toolSchema],
          tool_choice: "auto",
        };

        if (this.config.memoryTemperature !== false) {
          requestBody.temperature = this.config.memoryTemperature ?? 0.3;
        }

        if (this.config.extraParams) {
          applySafeExtraParams(requestBody, this.config.extraParams);
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (this.config.apiKey) {
          headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        const response = await fetch(`${this.config.apiUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text().catch(() => response.statusText);
          const safeErrorText = this.config.apiKey
            ? errorText.replaceAll(this.config.apiKey, "[REDACTED]")
            : errorText;
          const truncatedForLog =
            safeErrorText.length > 500 ? safeErrorText.slice(0, 500) + "..." : safeErrorText;
          log("OpenAI Chat Completion API error", {
            provider: this.getProviderName(),
            model: this.config.model,
            status: response.status,
            error: truncatedForLog,
            iteration: iterations,
          });

          let errorMessage = `API error: ${response.status} - ${safeErrorText}`;

          if (
            response.status === 400 &&
            errorText.includes("unsupported_value") &&
            errorText.includes("temperature")
          ) {
            errorMessage =
              'Your model does not support the temperature parameter. Add "memoryTemperature": false to your config file to disable it.';
          }

          return {
            success: false,
            error: errorMessage,
            iterations,
          };
        }

        const data: unknown = await response.json();

        if (isErrorResponseBody(data)) {
          log("API returned error in response body", {
            provider: this.getProviderName(),
            model: this.config.model,
            status: data.status,
            msg: data.msg,
          });
          return {
            success: false,
            error: `API error: ${data.status} - ${data.msg}`,
            iterations,
          };
        }

        if (!hasNonEmptyChoices(data)) {
          const choices =
            typeof data === "object" && data !== null
              ? (data as { choices?: unknown }).choices
              : undefined;

          log("Invalid API response format", {
            provider: this.getProviderName(),
            model: this.config.model,
            response: JSON.stringify(data).slice(0, 1000),
            hasChoices: Array.isArray(choices),
            choicesLength: Array.isArray(choices) ? choices.length : undefined,
          });
          return {
            success: false,
            error: "Invalid API response format",
            iterations,
          };
        }

        const choice = data.choices[0]!;

        const assistantSequence = ((await this.sessionRepo.getLastSequence(session.id)) ?? 0) + 1;
        const assistantMsg: AssistantSessionMessage = {
          aiSessionId: session.id,
          sequence: assistantSequence,
          role: "assistant",
          content: choice.message.content ?? "",
        };

        if (choice.message.tool_calls) {
          assistantMsg.toolCalls = choice.message.tool_calls;
        }

        await this.sessionRepo.addMessage(assistantMsg);
        messages.push({
          role: "assistant",
          content: choice.message.content ?? null,
          tool_calls: choice.message.tool_calls,
        });

        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
          for (const toolCall of choice.message.tool_calls) {
            const toolCallId = toolCall.id;

            if (toolCall.function.name === toolSchema.function.name) {
              try {
                const parsed = JSON.parse(toolCall.function.arguments);

                // Only validate with UserProfileValidator for profile-related tools
                if (
                  toolSchema.function.name === "updateUserProfile" ||
                  toolSchema.function.name === "getUserProfile"
                ) {
                  const result = UserProfileValidator.validate(parsed);
                  if (!result.valid) {
                    throw new Error(result.errors.join(", "));
                  }

                  await this.addToolResponse(
                    session.id,
                    messages,
                    toolCallId,
                    JSON.stringify({ success: true })
                  );

                  return {
                    success: true,
                    data: result.data,
                    iterations,
                  };
                }

                // For non-profile tools, return the parsed result directly
                await this.addToolResponse(
                  session.id,
                  messages,
                  toolCallId,
                  JSON.stringify({ success: true })
                );

                return {
                  success: true,
                  data: parsed,
                  iterations,
                };
              } catch (validationError) {
                const errorStack =
                  validationError instanceof Error ? validationError.stack : undefined;
                log("OpenAI tool response validation failed", {
                  error: String(validationError),
                  stack: errorStack,
                  errorType:
                    validationError instanceof Error
                      ? validationError.constructor.name
                      : typeof validationError,
                  toolName: toolSchema.function.name,
                  iteration: iterations,
                  rawArguments: toolCall.function.arguments.slice(0, 500),
                });

                const errorMessage =
                  validationError instanceof Error
                    ? `Validation failed: ${validationError.message}. Please provide valid JSON matching the expected schema.`
                    : `Validation failed: ${String(validationError)}`;
                await this.addToolResponse(session.id, messages, toolCallId, errorMessage);

                // Feed the error back to the model and let it retry
                break;
              }
            }

            const wrongToolMessage = `Wrong tool called. Please use ${toolSchema.function.name} instead.`;
            await this.addToolResponse(
              session.id,
              messages,
              toolCallId,
              JSON.stringify({ success: false, error: wrongToolMessage })
            );

            continue;
          }
        }

        const retrySequence = ((await this.sessionRepo.getLastSequence(session.id)) ?? 0) + 1;
        const retryPrompt =
          "Please use the save_memories tool to extract and save the memories from the conversation as instructed.";

        await this.sessionRepo.addMessage({
          aiSessionId: session.id,
          sequence: retrySequence,
          role: "user",
          content: retryPrompt,
        });

        messages.push({ role: "user", content: retryPrompt });
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof Error && error.name === "AbortError") {
          return {
            success: false,
            error: `API request timeout (${iterationTimeout}ms)`,
            iterations,
          };
        }
        return {
          success: false,
          error: String(error),
          iterations,
        };
      }
    }

    return {
      success: false,
      error: `Max iterations (${maxIterations}) reached without tool call`,
      iterations,
    };
  }
}
