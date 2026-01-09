export type AsyncLock = {
  acquire: () => Promise<void>;
  release: () => void;
};

export const createAsyncLock = (): AsyncLock => {
  const queue: (() => void)[] = [];
  let isLocked = false;

  return {
    acquire: async () => {
      if (!isLocked) {
        isLocked = true;
        return;
      }
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    },
    release: () => {
      const next = queue.shift();
      if (next) {
        next();
      } else {
        isLocked = false;
      }
    },
  };
};
