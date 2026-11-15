import { createClient, createInProcessStateAdapter } from "queuert";

import { notificationJobTypes } from "./slice-notifications-definitions.ts";
import { orderJobTypes } from "./slice-orders-definitions.ts";

export const stateAdapter = createInProcessStateAdapter({ mode: "async" });

export const client = createClient({
  stateAdapter,
  jobTypes: [orderJobTypes, notificationJobTypes],
});
