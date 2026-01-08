export type PgNotifyProviderContextType = "query" | "listen";

export type PgNotifyProvider<TContext> = {
  provideContext: (
    type: PgNotifyProviderContextType,
    fn: (context: TContext) => Promise<unknown>,
  ) => Promise<unknown>;
  publish: (context: TContext, channel: string, message: string) => Promise<void>;
  subscribe: (
    context: TContext,
    channel: string,
    onMessage: (message: string) => void,
  ) => Promise<() => Promise<void>>;
};
