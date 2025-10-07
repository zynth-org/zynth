import type { LLMClient } from "./types.js";
import { createGeminiLLM } from "./providers/gemini.js";
import { createMockLLM } from "./providers/mock.js";
import { createOpenAILLM } from "./providers/openai.js";

const llmClient = createLLMClient();

function createLLMClient(): LLMClient {
  const provider = process.env.SKYHOOK_LLM_PROVIDER?.toLowerCase() ?? "mock";

  switch (provider) {
    case "openai": {
      const apiKey = process.env.SKYHOOK_OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("[skyhook] SKYHOOK_OPENAI_API_KEY is required when SKYHOOK_LLM_PROVIDER=openai");
      }
      const model = process.env.SKYHOOK_OPENAI_MODEL ?? "gpt-4o-mini";
      return createOpenAILLM({
        apiKey,
        model,
        baseUrl: process.env.SKYHOOK_OPENAI_BASE_URL,
      });
    }
    case "gemini": {
      const apiKey = process.env.SKYHOOK_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("[skyhook] SKYHOOK_GEMINI_API_KEY is required when SKYHOOK_LLM_PROVIDER=gemini");
      }
      const model = process.env.SKYHOOK_GEMINI_MODEL ?? "gemini-1.5-flash";
      return createGeminiLLM({
        apiKey,
        model,
        baseUrl: process.env.SKYHOOK_GEMINI_BASE_URL,
      });
    }
    case "mock":
    default:
      if (provider !== "mock") {
        console.warn(
          `[skyhook] Unknown SKYHOOK_LLM_PROVIDER="${provider}", defaulting to mock implementation.`,
        );
      }
      return createMockLLM();
  }
}

export { llmClient };
export type { LLMClient };
