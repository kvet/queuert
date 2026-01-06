export type PgNotifyProviderContextType = "query" | "listen";

export type PgNotifyProvider<TContext> = {
  provideContext: <T>(
    type: PgNotifyProviderContextType,
    fn: (context: TContext) => Promise<T>,
  ) => Promise<T>;
  publish: (context: TContext, channel: string, message: string) => Promise<void>;
  subscribe: (
    context: TContext,
    channel: string,
    onMessage: (message: string) => void,
  ) => Promise<() => Promise<void>>;
};
