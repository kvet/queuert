export const createParallelExecutor = <T extends (...args: any[]) => Promise<any>>(
  maxSlots: number,
): {
  maxSlots: number;
  activeSlots: () => number;
  idleSlots: () => number;
  add: (fn: T) => Promise<ReturnType<T>>;
  onIdleSlot: (listener: () => void) => () => void;
  drain: () => Promise<void>;
} => {
  let activeSlots = 0;
  let drained = false;
  let idleSlotListener: (() => void) | undefined;
  let drainListener: (() => void) | undefined;

  return {
    maxSlots,
    activeSlots: () => activeSlots,
    idleSlots: () => maxSlots - activeSlots,
    add: async (fn: T): Promise<ReturnType<T>> => {
      if (drained) {
        throw new Error("Executor has been drained and cannot accept new tasks.");
      }
      if (activeSlots >= maxSlots) {
        throw new Error(`Cannot add new task, maximum concurrency of ${maxSlots} reached.`);
      }

      activeSlots++;
      try {
        return await fn();
      } finally {
        const wasAtCapacity = activeSlots === maxSlots;
        activeSlots--;
        if (wasAtCapacity && idleSlotListener) {
          idleSlotListener();
        }
        if (activeSlots === 0 && drainListener) {
          drainListener();
        }
      }
    },
    onIdleSlot: (listener: () => void) => {
      if (idleSlotListener) {
        throw new Error("An idle slot listener is already registered.");
      }
      idleSlotListener = listener;
      return () => {
        idleSlotListener = undefined;
      };
    },
    drain: async () => {
      if (drainListener) {
        throw new Error("A drain listener is already registered.");
      }
      if (activeSlots > 0) {
        await new Promise<void>((resolve) => {
          drainListener = resolve;
        });
      }
      drained = true;
    },
  };
};

export type ParallelExecutor<T extends (...args: any[]) => Promise<any>> = ReturnType<
  typeof createParallelExecutor<T>
>;
