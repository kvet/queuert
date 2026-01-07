import { BaseStateAdapterContext } from "queuert";

export type PgStateProvider<TContext extends BaseStateAdapterContext> = {
  provideContext: (fn: (context: TContext) => Promise<unknown>) => Promise<unknown>;
  executeSql: (context: TContext, query: string, params?: unknown[]) => Promise<unknown[]>;
  isInTransaction: (context: TContext) => Promise<boolean>;
  runInTransaction: (
    context: TContext,
    fn: (txContext: TContext) => Promise<unknown>,
  ) => Promise<unknown>;
};
