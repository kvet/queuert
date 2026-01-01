import { BaseStateAdapterContext } from "@queuert/core";

export type PgStateProvider<TContext extends BaseStateAdapterContext> = {
  provideContext: <T>(fn: (context: TContext) => Promise<T>) => Promise<T>;
  executeSql: <T>(context: TContext, query: string, params?: unknown[]) => Promise<T>;
  assertInTransaction: (context: TContext) => Promise<void>;
  runInTransaction: <T>(context: TContext, fn: (txContext: TContext) => Promise<T>) => Promise<T>;
};
