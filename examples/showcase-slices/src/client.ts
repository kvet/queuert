import { createClient } from "queuert";

import { notifyAdapter, stateAdapter } from "./adapters.js";
import { notificationJobTypes } from "./slice-notifications-definitions.js";
import { orderJobTypes } from "./slice-orders-definitions.js";

export const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [orderJobTypes, notificationJobTypes],
});
