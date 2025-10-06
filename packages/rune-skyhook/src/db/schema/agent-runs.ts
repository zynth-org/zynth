import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { generationRequests } from "./generation-requests.js";
import { projects } from "./projects.js";

const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().notNull(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").references(() => generationRequests.id, {
    onDelete: "set null",
  }),
  sandboxId: text("sandbox_id"),
  status: agentRunStatusEnum("status").default("queued").notNull(),
  llmModel: text("llm_model"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

type AgentRunStatus = (typeof agentRunStatusEnum.enumValues)[number];
type AgentRunRow = typeof agentRuns.$inferSelect;
type NewAgentRunRow = typeof agentRuns.$inferInsert;

export { agentRunStatusEnum, agentRuns };
export type { AgentRunRow, AgentRunStatus, NewAgentRunRow };
