import type { Hono } from "hono";
import { getHealthStatus } from "./handlers/get-health-status.js";

const registerHealthRoutes = (app: Hono) => {
  app.get("/health", getHealthStatus);
};

export { registerHealthRoutes };
