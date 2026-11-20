import type { Mode, MaybePromise } from "@queuert/sync-async";

import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import type { TxHooks } from "../tx-hooks/tx-hooks.ts";

export type EndToEndNotifyContext = {
  createStateAdapter?: StateAdapterConformanceContext["createStateAdapter"];
  createNotifyAdapter?: StateAdapterConformanceContext["createNotifyAdapter"];
  mode?: Mode;
};

export type EndToEndTxContext = { readonly $endToEndConformance: true; txHooks: TxHooks };

export type EndToEndSavepointContext = StateAdapterConformanceContext & {
  withSavepoint<T>(txCtx: any, fn: (txCtx: any) => MaybePromise<T>): MaybePromise<T>;
};

export type EndToEndPoisonTransactionContext = StateAdapterConformanceContext & {
  poisonTransaction(txCtx: any): MaybePromise<void>;
};

export type EndToEndFlakyDbContext = StateAdapterConformanceContext & {
  createFlakyDbStateAdapter: () => MaybePromise<StateAdapter<any, any, any, Mode>>;
  createFlakyConnectionStateAdapter: () => MaybePromise<StateAdapter<any, any, any, Mode>>;
};
