import { type Client } from "queuert";

export const MAX_IDS = 100;

const PER_ID_CONCURRENCY = 8;

/**
 * Probes the database after an adapter error: returns when the probe succeeds (so the error was
 * caused by the input, e.g. a malformed ID), and rethrows `err` when the probe fails too.
 */
export const probeOrRethrow = async (client: Client<any, any>, err: unknown): Promise<void> => {
  try {
    await client.listChainTypeNames();
  } catch {
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing the original adapter error
    throw err;
  }
};

/**
 * Runs an ID lookup and maps a malformed ID to `undefined`. Core has no read-side ID validation,
 * so a junk ID against a typed column (e.g. a Postgres `uuid`) makes the adapter throw; a
 * {@link probeOrRethrow} tells that apart from a database failure.
 */
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

/**
 * Batch variant of {@link lookupOrNotFound}. Tries the batch call first; if it throws, looks up
 * each ID on its own (at most {@link PER_ID_CONCURRENCY} at a time) and counts a lookup that
 * throws as not found. When every lookup throws, the probe decides between "nothing found" and
 * rethrowing the batch error.
 */
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

export const parseIds = (raw: string | null): string[] => [
  ...new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  ),
];
