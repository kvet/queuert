export const createParallelExecutor = <T extends (slot: number) => Promise<any>>(
  maxSlots: number,
): {
  maxSlots: number;
  activeSlots: () => number;
  idleSlots: () => number;
  add: (fn: T) => Promise<ReturnType<T>>;
  onIdleSlot: (listener: () => void) => () => void;
  drain: () => Promise<void>;
} => {
  const freeSlots = Array.from({ length: maxSlots }, (_, index) => maxSlots - 1 - index);
  let drained = false;
  let idleSlotListener: (() => void) | undefined;
  let drainListener: (() => void) | undefined;

  return {
    maxSlots,
    activeSlots: () => maxSlots - freeSlots.length,
    idleSlots: () => freeSlots.length,
    add: async (fn: T): Promise<ReturnType<T>> => {
      if (drained) {
        throw new Error("Executor has been drained and cannot accept new tasks.");
      }
      const slot = freeSlots.pop();
      if (slot === undefined) {
        throw new Error(`Cannot add new task, maximum concurrency of ${maxSlots} reached.`);
      }

      try {
        return await fn(slot);
      } finally {
        freeSlots.push(slot);
        if (idleSlotListener) {
          idleSlotListener();
        }
        if (freeSlots.length === maxSlots && drainListener) {
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
      if (freeSlots.length < maxSlots) {
        await new Promise<void>((resolve) => {
          drainListener = resolve;
        });
      }
      drained = true;
    },
  };
};

export type ParallelExecutor<T extends (slot: number) => Promise<any>> = ReturnType<
  typeof createParallelExecutor<T>
>;
