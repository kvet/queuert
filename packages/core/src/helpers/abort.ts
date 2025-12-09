export interface TypedAbortSignal<T> extends AbortSignal {
  readonly reason: T | undefined;
}

export interface TypedAbortController<T> {
  readonly signal: TypedAbortSignal<T>;
  abort(reason: T): void;
}
