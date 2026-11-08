export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof (value as { then?: unknown }).then === "function";

export const silence = (value: PromiseLike<unknown>): void => {
  value.then(undefined, () => {});
};
