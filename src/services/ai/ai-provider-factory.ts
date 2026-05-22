import { BaseAIProvider, type ProviderConfig } from "./providers/base-provider.js";
import { OpenAIChatCompletionProvider } from "./providers/openai-chat-completion.js";
import { createAISessionRepository } from "../storage/factory.js";
import type { AISessionRepository } from "../storage/types.js";

const sessionRepo: AISessionRepository = createAISessionRepository();

export class AIProviderFactory {
  static createProvider(providerType: string, config: ProviderConfig): BaseAIProvider {
    if (providerType === "openai-chat") {
      return new OpenAIChatCompletionProvider(config, sessionRepo);
    }

    throw new Error(`Unknown provider type: ${providerType}`);
  }

  static getSupportedProviders(): string[] {
    return ["openai-chat"];
  }

  static async cleanupExpiredSessions(): Promise<number> {
    return await sessionRepo.cleanupExpiredSessions();
  }
}
