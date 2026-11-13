/**
 * Thrown when a Redis transaction keeps conflicting with concurrent commits: every try found a
 * record or dependency set it read changed by another transaction before it could commit. When the
 * last try's callback threw after reading changed records, that error is the `cause`.
 *
 * @experimental
 */
export class RedisTransactionConflictError extends Error {
  /** Number of tries the transaction ran before giving up. */
  readonly tries: number;

  constructor(message: string, options: { tries: number; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "RedisTransactionConflictError";
    this.tries = options.tries;
  }
}
