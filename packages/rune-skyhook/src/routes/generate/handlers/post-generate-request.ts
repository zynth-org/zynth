import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { db } from "../../../db/client.js";
import { generationRequests } from "../../../db/schema.js";
import { llmClient } from "../../../llm/index.js";
import type { GenerateRequest } from "../../../types/generate.js";

const postGenerateRequest = async (c: Context) => {
  let payload: GenerateRequest;

  try {
    payload = await c.req.json<GenerateRequest>();
  } catch (error) {
    return c.json({ error: "Invalid JSON body", details: String(error) }, 400);
  }

  if (!payload.prompt || !payload.prompt.trim()) {
    return c.json({ error: "prompt is required" }, 400);
  }

  const prompt = payload.prompt.trim();
  const projectId = payload.projectId?.trim() || null;

  if (projectId && !isUuid(projectId)) {
    return c.json({ error: "projectId must be a valid UUID" }, 400);
  }

  try {
    const requestId = randomUUID();

    const [request] = await db
      .insert(generationRequests)
      .values({
        id: requestId,
        prompt,
        projectId,
        status: "pending",
      })
      .returning();

    if (!request) {
      return c.json({ error: "Failed to persist generation request" }, 500);
    }

    const llmPreview = await requestPreviewFromLLM({
      prompt,
      requestId,
    });

    return c.json(
      {
        requestId,
        status: request.status,
        message: "Skyhook Stage 1 stub: orchestration pipeline not implemented yet.",
        prompt: request.prompt,
        projectId: request.projectId,
        llmPreview,
        createdAt: request.createdAt?.toISOString() ?? null,
      },
      202,
    );
  } catch (error) {
    console.error("[skyhook] failed to save generation request", error);
    return c.json({ error: "Failed to persist generation request" }, 500);
  }
};

const requestPreviewFromLLM = async ({
  prompt,
  requestId,
}: {
  prompt: string;
  requestId: string;
}) => {
  try {
    const result = await llmClient.generateText({
      system:
        "You are Rune Skyhook, an AI pair programmer that orchestrates autonomous app builds. Reply with a one sentence summary of how you plan to approach the request.",
      prompt: `Request ID: ${requestId}\nUser Prompt: ${prompt}`,
      temperature: 0.2,
    });

    return result.output;
  } catch (error) {
    console.error("[skyhook] Failed to fetch LLM preview", error);
    return null;
  }
};

export { postGenerateRequest };

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
