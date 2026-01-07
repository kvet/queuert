import { BaseStateAdapterContext } from "queuert";

export type SqliteStateProvider<TContext extends BaseStateAdapterContext> = {
  provideContext: (fn: (context: TContext) => Promise<unknown>) => Promise<unknown>;
  executeSql: (
    context: TContext,
    sql: string,
    params: unknown[] | undefined,
    returns: boolean,
  ) => Promise<unknown[]>;
  isInTransaction: (context: TContext) => Promise<boolean>;
  runInTransaction: (
    context: TContext,
    fn: (context: TContext) => Promise<unknown>,
  ) => Promise<unknown>;
};
