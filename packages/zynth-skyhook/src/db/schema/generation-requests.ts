import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps.js";

const generationStatusEnum = pgEnum("generation_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

const generationRequests = pgTable("generation_requests", {
  id: uuid("id").primaryKey().notNull(),
  prompt: text("prompt").notNull(),
  appId: uuid("app_id").references(() => apps.id, {
    onDelete: "set null",
  }),
  status: generationStatusEnum("status").default("pending").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

type GenerationStatus = (typeof generationStatusEnum.enumValues)[number];
type GenerationRequestRow = typeof generationRequests.$inferSelect;
type NewGenerationRequestRow = typeof generationRequests.$inferInsert;

export { generationRequests, generationStatusEnum };
export type { GenerationRequestRow, GenerationStatus, NewGenerationRequestRow };