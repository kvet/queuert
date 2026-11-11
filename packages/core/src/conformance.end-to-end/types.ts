import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";

export type EndToEndTxContext = { readonly $endToEndConformance: true };

export type EndToEndSavepointContext = StateAdapterConformanceContext & {
  withSavepoint: <T>(txCtx: any, fn: (txCtx: any) => Promise<T>) => Promise<T>;
};

export type EndToEndPoisonTransactionContext = StateAdapterConformanceContext & {
  poisonTransaction: (txCtx: any) => Promise<void>;
};

export type EndToEndFlakyDbContext = StateAdapterConformanceContext & {
  createFlakyDbStateAdapter: () => Promise<StateAdapter<any, any, any>>;
  createFlakyConnectionStateAdapter: () => Promise<StateAdapter<any, any, any>>;
};

export type EndToEndStateAdapter = StateAdapter<EndToEndTxContext, string, string>;
