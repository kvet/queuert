import { BaseStateAdapterContext } from "@queuert/core";

export type SqliteStateProvider<TContext extends BaseStateAdapterContext> = {
  provideContext: (fn: (context: TContext) => Promise<unknown>) => Promise<unknown>;
  executeSql: (
    context: TContext,
    sql: string,
    params: unknown[] | undefined,
    returns: boolean,
  ) => Promise<unknown[]>;
  assertInTransaction: (context: TContext) => Promise<void>;
  runInTransaction: (
    context: TContext,
    fn: (context: TContext) => Promise<unknown>,
  ) => Promise<unknown>;
};
