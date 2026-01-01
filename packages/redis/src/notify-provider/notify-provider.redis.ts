export type RedisNotifyProviderContextType = "command" | "subscribe" | "brpop";

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
  lpush: (context: TContext, queue: string, message: string) => Promise<void>;
  brpop: (
    context: TContext,
    queues: string[],
    timeoutMs: number,
  ) => Promise<{ queue: string; message: string } | undefined>;
};
