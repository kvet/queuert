import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

export const pet = pgTable("pet", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id")
    .references(() => users.id)
    .notNull(),
  name: text("name").notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Pet = typeof pet.$inferSelect;
export type NewPet = typeof pet.$inferInsert;
