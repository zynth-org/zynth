import { Hono } from "hono";
import { registerGenerateRoutes } from "./routes/generate/index.js";
import { registerHealthRoutes } from "./routes/health/index.js";

const createApp = () => {
  const app = new Hono();

  registerHealthRoutes(app);
  registerGenerateRoutes(app);

  return app;
};

export { createApp };
