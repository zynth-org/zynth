import type { GenerateTextInput, GenerateTextResult, LLMClient } from "../types.js";

type OpenAIConfig = {
  apiKey: string;
  model: string;
  baseUrl?: string;
};

const createOpenAILLM = (config: OpenAIConfig): LLMClient => {
  const baseUrl = (config.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");

  return {
    provider: "openai",
    model: config.model,
    async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
      const payload = {
        model: config.model,
        messages: buildMessages(input),
        temperature: input.temperature ?? 0.2,
      };

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[skyhook] OpenAI request failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as any;
      const output =
        data?.choices?.[0]?.message?.content?.toString().trim() ??
        "[openai] empty response";

      return { output, raw: data };
    },
  };
};

const buildMessages = (input: GenerateTextInput) => {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];

  if (input.system) {
    messages.push({ role: "system", content: input.system });
  }

  messages.push({
    role: "user",
    content: input.prompt,
  });

  return messages;
};

export { createOpenAILLM };
