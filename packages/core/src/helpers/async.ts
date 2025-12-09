export const createSignal = <T = void>(): {
  onSignal: Promise<T>;
  signalled: boolean;
  signalOnce: (value: T) => void;
} => {
  const { promise, resolve } = Promise.withResolvers<T>();
  let resolved = false;
  return {
    onSignal: promise,
    get signalled() {
      return resolved;
    },
    signalOnce: (value: T) => {
      if (!resolved) {
        resolve(value);
        resolved = true;
      }
    },
  };
};
