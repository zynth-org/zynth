import type { Context } from "hono";
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

  return c.json(
    {
      status: "pending",
      message: "Skyhook Stage 1 stub: generation pipeline not implemented yet.",
      prompt: payload.prompt,
      projectId: payload.projectId ?? null,
    },
    202,
  );
};

export { postGenerateRequest };
