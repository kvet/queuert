export type TypedAbortSignal<T> = {
  readonly reason: T | undefined;
} & AbortSignal;

export type TypedAbortController<T> = {
  readonly signal: TypedAbortSignal<T>;
  abort(reason: T): void;
};
