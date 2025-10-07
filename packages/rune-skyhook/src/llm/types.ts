type GenerateTextInput = {
  prompt: string;
  system?: string;
  temperature?: number;
};

type GenerateTextResult = {
  output: string;
  raw?: unknown;
};

type LLMClient = {
  provider: string;
  model: string;
  generateText: (input: GenerateTextInput) => Promise<GenerateTextResult>;
};

export type { GenerateTextInput, GenerateTextResult, LLMClient };
