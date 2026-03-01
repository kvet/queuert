export { createNatsNotifyAdapter } from "./notify-adapter/notify-adapter.nats.js";

import { type NotifyAdapter } from "queuert";

/**
 * NATS notify adapter type. Alias for {@link NotifyAdapter}.
 * @experimental
 */
export type NatsNotifyAdapter = NotifyAdapter;
