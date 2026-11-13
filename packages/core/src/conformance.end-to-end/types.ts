import type { MaybePromise } from "@queuert/helpers/maybe-promise";

import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import type { ConformanceStateAdapter } from "../conformance/adapters.ts";
import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import type { TxHooks } from "../tx-hooks/tx-hooks.ts";

export type EndToEndTxContext = { readonly $endToEndConformance: true; txHooks: TxHooks };

export type EndToEndSavepointContext = StateAdapterConformanceContext & {
  withSavepoint<T>(txCtx: any, fn: (txCtx: any) => MaybePromise<T>): MaybePromise<T>;
};

export type EndToEndPoisonTransactionContext = StateAdapterConformanceContext & {
  poisonTransaction(txCtx: any): MaybePromise<void>;
};

export type EndToEndFlakyDbContext = StateAdapterConformanceContext & {
  createFlakyDbStateAdapter: () => MaybePromise<ConformanceStateAdapter>;
  createFlakyConnectionStateAdapter: () => MaybePromise<ConformanceStateAdapter>;
};

/**
 * The state adapter an end-to-end case builds its client over. Typed as an async adapter so the
 * client's calls type as promises; over a sync adapter they return plain values, which the cases
 * await all the same.
 */
export type EndToEndStateAdapter = StateAdapter<EndToEndTxContext, string, string>;

/** The notify adapter an end-to-end case builds its client over, typed as async for the same reason. */
export type EndToEndNotifyAdapter = NotifyAdapter;
