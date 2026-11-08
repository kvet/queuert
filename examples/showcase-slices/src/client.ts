import { createClient } from "queuert";

import { notifyAdapter, stateAdapter } from "./adapters.ts";
import { notificationJobTypes } from "./slice-notifications-definitions.ts";
import { orderJobTypes } from "./slice-orders-definitions.ts";

export const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [orderJobTypes, notificationJobTypes],
});
