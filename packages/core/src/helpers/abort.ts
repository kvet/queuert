/** An `AbortSignal` with a typed `reason` property. */
export type TypedAbortSignal<T> = Omit<AbortSignal, "reason"> & {
  readonly reason: T | undefined;
};

/** An `AbortController` with a typed signal and `abort(reason)`. */
export type TypedAbortController<T> = {
  readonly signal: TypedAbortSignal<T>;
  abort(reason: T): void;
};
