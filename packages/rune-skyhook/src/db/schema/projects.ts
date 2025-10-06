import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const projects = pgTable("projects", {
  id: uuid("id").primaryKey().notNull(),
  userId: text("user_id"),
  name: text("name").notNull(),
  description: text("description"),
  iconUrl: text("icon_url"),
  splashUrl: text("splash_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

type ProjectRow = typeof projects.$inferSelect;
type NewProjectRow = typeof projects.$inferInsert;

export { projects };
export type { NewProjectRow, ProjectRow };
