export type TypedAbortSignal<T> = Omit<AbortSignal, "reason"> & {
  readonly reason: T | undefined;
};

export type TypedAbortController<T> = {
  readonly signal: TypedAbortSignal<T>;
  abort(reason: T): void;
};
