export const wrapOperation = <TAdapter, TKey extends keyof TAdapter>(
  adapter: TAdapter,
  operation: TKey,
  onError: (operation: TKey, error: unknown) => void,
): TAdapter[TKey] => {
  const fn = adapter[operation] as (...args: unknown[]) => Promise<unknown>;
  return (async (...args: unknown[]) => {
    try {
      return await fn.call(adapter, ...args);
    } catch (error) {
      onError(operation, error);
      throw error;
    }
  }) as TAdapter[TKey];
};
