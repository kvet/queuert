import { BaseStateAdapterContext } from "@queuert/core";

export type PgStateProvider<TContext extends BaseStateAdapterContext> = {
  provideContext: (fn: (context: TContext) => Promise<unknown>) => Promise<unknown>;
  executeSql: (context: TContext, query: string, params?: unknown[]) => Promise<unknown[]>;
  assertInTransaction: (context: TContext) => Promise<void>;
  runInTransaction: (
    context: TContext,
    fn: (txContext: TContext) => Promise<unknown>,
  ) => Promise<unknown>;
};
