import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const apps = pgTable("apps", {
  id: uuid("id").primaryKey().notNull(),
  userId: text("user_id"),
  name: text("name").notNull(),
  description: text("description"),
  iconUrl: text("icon_url"),
  splashUrl: text("splash_url"),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

type AppRow = typeof apps.$inferSelect;
type NewAppRow = typeof apps.$inferInsert;

export { apps };
export type { NewAppRow, AppRow };