import { BaseStateAdapterContext } from "queuert";

export type PgStateProvider<
  TContext extends BaseStateAdapterContext,
  TProvideContext extends BaseStateAdapterContext = TContext,
> = {
  provideContext: (fn: (context: TProvideContext) => Promise<unknown>) => Promise<unknown>;
  executeSql: (context: TContext, query: string, params?: unknown[]) => Promise<unknown[]>;
  isInTransaction: (context: TContext) => Promise<boolean>;
  runInTransaction: (
    context: TProvideContext,
    fn: (txContext: TContext) => Promise<unknown>,
  ) => Promise<unknown>;
};
