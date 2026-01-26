export const createParallelExecutor = <T extends (...args: any[]) => Promise<any>>(
  maxSlots: number,
): {
  maxSlots: number;
  activeSlots: () => number;
  idleSlots: () => number;
  add: (fn: T) => Promise<ReturnType<T>>;
  waitForIdleSlot: () => Promise<void>;
} => {
  let activeSlots = 0;
  const waiters: (() => void)[] = [];

  return {
    maxSlots,
    activeSlots: () => activeSlots,
    idleSlots: () => maxSlots - activeSlots,
    add: async (fn: T): Promise<ReturnType<T>> => {
      if (activeSlots >= maxSlots) {
        throw new Error(`Cannot add new task, maximum concurrency of ${maxSlots} reached.`);
      }

      activeSlots++;
      try {
        return await fn();
      } finally {
        activeSlots--;
        const next = waiters.shift();
        if (next) {
          next();
        }
      }
    },
    waitForIdleSlot: async () => {
      if (activeSlots < maxSlots) {
        return;
      }
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },
  };
};
