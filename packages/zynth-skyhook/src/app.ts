import { Hono } from "hono";
import { createAppHandler } from "./controllers/create-app.js";
import { getHealth } from "./controllers/health.js";
import { updateAppHandler } from "./controllers/update-app.js";

const createApp = () => {
  const app = new Hono();

  app.get("/health", getHealth);
  app.post("/app/create", createAppHandler);
  app.post("/app/:appId/source/update", updateAppHandler);

  return app;
};

export { createApp };
