import { createClient, mergeJobTypeRegistries } from "queuert";
import { notifyAdapter, stateAdapter } from "./adapters.js";
import { notificationJobTypeRegistry } from "./slice-notifications-definitions.js";
import { orderJobTypeRegistry } from "./slice-orders-definitions.js";

export const jobTypeRegistry = mergeJobTypeRegistries({
  slices: [orderJobTypeRegistry, notificationJobTypeRegistry],
});

export const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry,
});
