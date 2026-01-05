export type RedisNotifyProviderContextType = "command" | "subscribe";

export type RedisNotifyProvider<TContext> = {
  provideContext: <T>(
    type: RedisNotifyProviderContextType,
    fn: (context: TContext) => Promise<T>,
  ) => Promise<T>;
  publish: (context: TContext, channel: string, message: string) => Promise<void>;
  subscribe: (
    context: TContext,
    channel: string,
    onMessage: (message: string) => void,
  ) => Promise<() => Promise<void>>;
  eval: (context: TContext, script: string, keys: string[], args: string[]) => Promise<unknown>;
};
