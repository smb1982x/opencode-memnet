import { BaseAIProvider, type ProviderConfig } from "./providers/base-provider.js";
import { OpenAIChatCompletionProvider } from "./providers/openai-chat-completion.js";
import { OpenAIResponsesProvider } from "./providers/openai-responses.js";
import { AnthropicMessagesProvider } from "./providers/anthropic-messages.js";
import { GoogleGeminiProvider } from "./providers/google-gemini.js";
import { createAISessionRepository } from "../storage/factory.js";
import type { AISessionRepository } from "../storage/types.js";

const sessionRepo: AISessionRepository = createAISessionRepository();

export class AIProviderFactory {
  static createProvider(providerType: string, config: ProviderConfig): BaseAIProvider {
    switch (providerType) {
      case "openai-chat":
        return new OpenAIChatCompletionProvider(config, sessionRepo);

      case "openai-responses":
        return new OpenAIResponsesProvider(config, sessionRepo);

      case "anthropic":
        return new AnthropicMessagesProvider(config, sessionRepo);

      case "google-gemini":
        return new GoogleGeminiProvider(config, sessionRepo);

      default:
        throw new Error(`Unknown provider type: ${providerType}`);
    }
  }

  static getSupportedProviders(): string[] {
    return ["openai-chat", "openai-responses", "anthropic", "google-gemini"];
  }

  static async cleanupExpiredSessions(): Promise<number> {
    return await sessionRepo.cleanupExpiredSessions();
  }
}
