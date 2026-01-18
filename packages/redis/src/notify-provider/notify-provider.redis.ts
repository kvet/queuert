/**
 * Redis notify provider interface.
 *
 * Abstracts Redis pub/sub operations. The provider manages
 * connections internally - no explicit context management required.
 */
export type RedisNotifyProvider = {
  /**
   * Publishes a message to a channel.
   * Internally uses the command client.
   */
  publish: (channel: string, message: string) => Promise<void>;

  /**
   * Subscribes to a channel.
   * The provider uses a dedicated subscription client internally.
   * Returns an unsubscribe function.
   */
  subscribe: (
    channel: string,
    onMessage: (message: string) => void,
  ) => Promise<() => Promise<void>>;

  /**
   * Executes a Lua script.
   * Internally uses the command client.
   */
  eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;
};
