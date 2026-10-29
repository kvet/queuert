/**
 * PostgreSQL notify provider interface.
 *
 * Abstracts PostgreSQL LISTEN/NOTIFY operations. The provider manages
 * connections internally - no explicit context management required.
 */
export type PgNotifyProvider = {
  /**
   * Publishes messages to a channel in one statement, e.g.
   * `SELECT pg_notify($1, message) FROM unnest($2::text[]) AS message`.
   * Internally acquires a connection, publishes, and releases.
   */
  publish: (channel: string, messages: string[]) => Promise<void>;

  /**
   * Subscribes to a channel.
   * The provider manages a dedicated listen connection internally.
   * Returns an unsubscribe function.
   */
  subscribe: (
    channel: string,
    onMessage: (message: string) => void,
  ) => Promise<() => Promise<void>>;

  /**
   * Releases provider-owned resources (e.g. a dedicated LISTEN client).
   * Optional — pass-through providers (user-owned pool/client) can omit it.
   * When defined, must be idempotent: the second call is a no-op, and after
   * close `publish` and `subscribe` reject.
   */
  close?: () => Promise<void>;
};
