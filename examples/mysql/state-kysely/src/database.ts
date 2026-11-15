import type { Generated } from "kysely";

export type Database = {
  users: { id: Generated<number>; name: string; email: string };
  invoices: { id: Generated<number>; customer: string; amount_cents: number };
};
