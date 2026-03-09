import { createClient, mergeJobTypeRegistries } from "queuert";
import { notifyAdapter, stateAdapter } from "./adapters.js";
import { notificationJobTypeRegistry } from "./slice-notifications-definitions.js";
import { orderJobTypeRegistry } from "./slice-orders-definitions.js";

export const registry = mergeJobTypeRegistries(orderJobTypeRegistry, notificationJobTypeRegistry);

export const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});
