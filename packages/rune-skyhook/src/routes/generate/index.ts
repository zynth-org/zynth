import type { Hono } from "hono";
import { postGenerateRequest } from "./handlers/post-generate-request.js";

const registerGenerateRoutes = (app: Hono) => {
  app.post("/api/generate", postGenerateRequest);
};

export { registerGenerateRoutes };
