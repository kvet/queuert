/**
 * Redis state provider interface.
 *
 * The Redis state adapter reads and writes only through Lua scripts, so a provider wraps one
 * command client of any Redis driver. Every script names one key, and every key the adapter
 * touches shares one hash tag, so a cluster routes all of them to one node.
 *
 * @experimental
 */
export type RedisStateProvider = {
  /**
   * Runs a Lua script on the command client (`EVAL`, or `EVALSHA` with an `EVAL` fallback) and
   * returns its reply.
   */
  eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;

  /**
   * Releases provider-owned resources. Optional — pass-through providers
   * (user-owned client) can omit it. When defined, must be idempotent.
   */
  close?: () => Promise<void>;
};
