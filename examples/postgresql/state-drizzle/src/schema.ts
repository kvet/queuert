import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  customer: text("customer").notNull(),
  totalCents: integer("total_cents").notNull(),
  status: text("status"),
});
