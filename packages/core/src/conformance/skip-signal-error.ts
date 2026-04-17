/**
 * Thrown by `expect.skip(reason)` to mark a case as skipped rather than
 * passed or failed. The runner catches instances of this class and records
 * `result.status = "skip"`.
 */
export class SkipSignalError extends Error {
  override readonly name = "SkipSignalError";

  constructor(reason: string) {
    super(reason);
  }

  get reason(): string {
    return this.message;
  }
}
