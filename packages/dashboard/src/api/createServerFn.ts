import { type CreateServerFn, createServerFnFactory } from "@queuert/rpc/server";
import type { Client } from "queuert";

export const createServerFn: CreateServerFn<{ client: Client<any, any> }> = createServerFnFactory<{
  client: Client<any, any>;
}>();
