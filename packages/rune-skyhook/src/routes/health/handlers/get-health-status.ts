import type { Context } from "hono";

const getHealthStatus = (c: Context) => {
  return c.json({ status: "ok" });
};

export { getHealthStatus };
