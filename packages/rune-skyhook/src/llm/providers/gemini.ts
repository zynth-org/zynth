import type { GenerateTextInput, GenerateTextResult, LLMClient } from "../types.js";

type GeminiConfig = {
  apiKey: string;
  model: string;
  baseUrl?: string;
};

const createGeminiLLM = (config: GeminiConfig): LLMClient => {
  const baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");

  return {
    provider: "gemini",
    model: config.model,
    async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
      const url = `${baseUrl}/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
      const payload = {
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(input) }],
          },
        ],
        generationConfig: {
          temperature: input.temperature ?? 0.2,
        },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[skyhook] Gemini request failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as any;
      const output =
        data?.candidates?.[0]?.content?.parts?.[0]?.text?.toString().trim() ??
        "[gemini] empty response";

      return { output, raw: data };
    },
  };
};

const buildPrompt = (input: GenerateTextInput) => {
  if (input.system) {
    return `${input.system}\n\n${input.prompt}`;
  }

  return input.prompt;
};

export { createGeminiLLM };
