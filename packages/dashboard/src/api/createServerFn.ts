import { type CreateServerFn, createServerFnFactory } from "@queuert/rpc/server";
import type { Client } from "queuert";

/** A client of either mode: over `any` adapter, its state-touching methods type as `T | Promise<T>`. */
export type DashboardClient = Client<any, any>;

export const createServerFn: CreateServerFn<{ client: DashboardClient }> = createServerFnFactory<{
  client: DashboardClient;
}>();
