export type BaseStateProviderContext = Record<string, unknown>;

export type StateProvider<TContext extends BaseStateProviderContext> = {
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

export type GetStateProviderContext<TStateProvider> =
  TStateProvider extends StateProvider<infer TContext> ? TContext : never;
