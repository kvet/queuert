export { createNatsNotifyAdapter } from "./notify-adapter/notify-adapter.nats.js";

import { type NotifyAdapter } from "queuert";

export type NatsNotifyAdapter = NotifyAdapter;
