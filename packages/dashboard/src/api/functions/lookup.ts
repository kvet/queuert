import type { Client } from "queuert";

const PER_ID_CONCURRENCY = 8;

export const probeOrRethrow = async (client: Client<any, any>, err: unknown): Promise<void> => {
  try {
    await client.getChainTypeNames();
  } catch {
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing the original adapter error
    throw err;
  }
};

export const lookupOrNotFound = async <T>(
  client: Client<any, any>,
  lookup: () => Promise<T>,
): Promise<T | undefined> => {
  try {
    return await lookup();
  } catch (err) {
    await probeOrRethrow(client, err);
    return undefined;
  }
};

export const lookupEachOrNotFound = async <T>(
  client: Client<any, any>,
  ids: string[],
  lookupMany: (ids: string[]) => Promise<(T | undefined)[]>,
): Promise<T[]> => {
  const present = (items: (T | undefined)[]): T[] =>
    items.filter((item): item is T => item != null);

  try {
    return present(await lookupMany(ids));
  } catch (batchErr) {
    const results: ({ ok: true; item: T | undefined } | { ok: false })[] = Array.from({
      length: ids.length,
    });
    let next = 0;
    const runWorker = async () => {
      while (next < ids.length) {
        const index = next++;
        try {
          const [item] = await lookupMany([ids[index]]);
          results[index] = { ok: true, item };
        } catch {
          results[index] = { ok: false };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PER_ID_CONCURRENCY, ids.length) }, async () => runWorker()),
    );

    if (results.every((result) => !result.ok)) {
      await probeOrRethrow(client, batchErr);
      return [];
    }
    return present(results.map((result) => (result.ok ? result.item : undefined)));
  }
};
