import { createClient, mergeJobTypeRegistries } from "queuert";
import { notifyAdapter, stateAdapter } from "./adapters.js";
import { notificationJobTypes } from "./slice-notifications-definitions.js";
import { orderJobTypes } from "./slice-orders-definitions.js";

export const registry = mergeJobTypeRegistries(orderJobTypes, notificationJobTypes);

export const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});
