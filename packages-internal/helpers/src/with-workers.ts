export const withWorkers = async <T>(
  workers: (() => Promise<void>)[],
  cb: () => Promise<T>,
): Promise<T> => {
  try {
    return await cb();
  } finally {
    await Promise.all(workers.map(async (w) => w()));
  }
};
