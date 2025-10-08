import { Hono } from "hono";
import { postGenerateRequest } from "./controllers/generate.js";
import { getHealth } from "./controllers/health.js";

const createApp = () => {
  const app = new Hono();

  app.get("/health", getHealth);
  app.post("/api/generate", postGenerateRequest);

  return app;
};

export { createApp };