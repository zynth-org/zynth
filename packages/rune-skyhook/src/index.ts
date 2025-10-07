import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import "./storage/index.js";
import "./llm/index.js";

const app = createApp();
const port = resolvePort();

console.log(`[skyhook] listening on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});

function resolvePort(): number {
  const raw = process.env.SKYHOOK_PORT ?? process.env.PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : undefined;
  return Number.isFinite(parsed) ? (parsed as number) : 9964;
}

export { createApp };
