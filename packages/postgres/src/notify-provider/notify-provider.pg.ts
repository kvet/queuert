/**
 * PostgreSQL notify provider interface.
 *
 * Abstracts PostgreSQL LISTEN/NOTIFY operations. The provider manages
 * connections internally - no explicit context management required.
 */
export type PgNotifyProvider = {
  /**
   * Publishes a message to a channel.
   * Internally acquires a connection, publishes, and releases.
   */
  publish: (channel: string, message: string) => Promise<void>;

  /**
   * Subscribes to a channel.
   * The provider manages a dedicated listen connection internally.
   * Returns an unsubscribe function.
   */
  subscribe: (
    channel: string,
    onMessage: (message: string) => void,
  ) => Promise<() => Promise<void>>;
};
