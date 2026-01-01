import { BaseStateAdapterContext } from "@queuert/core";

export type SqliteStateProvider<TContext extends BaseStateAdapterContext> = {
  provideContext: <T>(fn: (context: TContext) => Promise<T>) => Promise<T>;
  executeSql: <TResult>(
    context: TContext,
    sql: string,
    params: unknown[] | undefined,
    returns: boolean,
  ) => Promise<TResult>;
  assertInTransaction: (context: TContext) => Promise<void>;
  runInTransaction: <T>(context: TContext, fn: (context: TContext) => Promise<T>) => Promise<T>;
};
