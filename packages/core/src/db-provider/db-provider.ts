export type BaseDbProviderContext = Record<string, unknown>;

export type QueuertDbProvider<TContext extends BaseDbProviderContext> = {
  provideContext: <T>(fn: (context: TContext) => Promise<T>) => Promise<T>;
  executeSql: <T>(
    context: TContext,
    query: string,
    params?: unknown[]
  ) => Promise<T>;
  assertInTransaction: (context: TContext) => Promise<void>;
  runInTransaction: <T>(
    context: TContext,
    fn: (txContext: TContext) => Promise<T>
  ) => Promise<T>;
};

export type GetDbProviderContext<TDbProvider> =
  TDbProvider extends QueuertDbProvider<infer TContext> ? TContext : never;
