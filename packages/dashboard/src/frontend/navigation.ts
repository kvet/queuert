import { type Accessor, type Setter, createSignal } from "solid-js";

/**
 * Whether the user has navigated within the app at least once this session — set by an
 * effect in `App` on the first route change. Detail views use it to decide whether a
 * history-back ("← Back") is safe, or whether to fall back to a list (deep link / new tab).
 */
const [cameFromAppSignal, setCameFromAppSignal] = createSignal(false);

export const cameFromApp: Accessor<boolean> = cameFromAppSignal;
export const setCameFromApp: Setter<boolean> = setCameFromAppSignal;
