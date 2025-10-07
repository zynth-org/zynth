import type { GenerateTextInput, GenerateTextResult, LLMClient } from "../types.js";

const createMockLLM = (): LLMClient => ({
  provider: "mock",
  model: "mock",
  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const snippet = input.prompt.substring(0, 200);
    return {
      output: `[mocked llm]\n${snippet}`,
    };
  },
});

export { createMockLLM };
