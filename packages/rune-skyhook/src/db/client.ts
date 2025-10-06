import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "[skyhook] DATABASE_URL is not defined. Set it to a Postgres connection string before starting the server.",
  );
}

const poolSize = parsePositiveInt(process.env.DATABASE_POOL_MAX) ?? 10;

const pgClient = postgres(databaseUrl, {
  max: poolSize,
  idle_timeout: 20,
  max_lifetime: 60 * 15,
  prepare: false,
});

const db = drizzle(pgClient, { schema });

function parsePositiveInt(value?: string) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export { db, pgClient };
