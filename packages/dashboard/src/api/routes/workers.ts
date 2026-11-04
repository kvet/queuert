import { type Client, type Worker } from "queuert";

import { serovalResponse } from "../response.js";
import { MAX_IDS, lookupEachOrNotFound, lookupOrNotFound, parseIds } from "./lookup.js";
import { parseCursor, parseLimit } from "./params.js";

const withRunningJobCounts = async (
  client: Client<any, any>,
  workers: Worker<string>[],
): Promise<(Worker<string> & { runningJobCount: number })[]> => {
  const counts = await client.countRunningJobsByWorkerId({
    workerIds: workers.map((worker) => worker.id),
  });
  return workers.map((worker, index) => ({ ...worker, runningJobCount: counts[index] }));
};

export const handleWorkersList = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const typeName = url.searchParams.get("typeName");
  const result = await client.listWorkers({
    typeName: typeName === "" ? undefined : (typeName ?? undefined),
    cursor: parseCursor(url.searchParams.get("cursor") ?? undefined, {
      type: "timestampWithId",
      sortKey: "startedAt",
    }),
    limit: parseLimit(url.searchParams.get("limit") ?? undefined),
  });
  return serovalResponse({
    items: await withRunningJobCounts(client, result.items),
    nextCursor: result.nextCursor,
  });
};

export const handleWorkersCounts = async (client: Client<any, any>): Promise<Response> =>
  serovalResponse(await client.countWorkers());

export const handleWorkersByIds = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const ids = parseIds(url.searchParams.get("ids"));
  if (ids.length > MAX_IDS) return serovalResponse({ error: `At most ${MAX_IDS} IDs` }, 400);
  if (ids.length === 0) return serovalResponse({ items: [], nextCursor: null });
  const workers = await lookupEachOrNotFound(client, ids, async (batch) =>
    client.getWorkers({ ids: batch }),
  );
  return serovalResponse({
    items: await withRunningJobCounts(client, workers),
    nextCursor: null,
  });
};

const decodeWorkerId = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

export const handleWorkerDetail = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const id = url.searchParams.get("id");
  const worker = id
    ? await lookupOrNotFound(client, async () => client.getWorker({ id }))
    : undefined;
  if (!worker) {
    return serovalResponse({ error: "Worker not found" }, 404);
  }
  const [workerWithCount] = await withRunningJobCounts(client, [worker]);
  return serovalResponse({ worker: workerWithCount });
};

export const handleWorkerJobs = async (
  url: URL,
  client: Client<any, any>,
  workerId: string,
): Promise<Response> => {
  const id = decodeWorkerId(workerId);
  const cursor = parseCursor(url.searchParams.get("cursor") ?? undefined, {
    type: "timestampWithId",
    sortKey: "attemptAt",
  });
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);
  const result =
    id === undefined
      ? undefined
      : await lookupOrNotFound(client, async () =>
          client.listWorkerJobs({ workerId: id, cursor, limit }),
        );
  return serovalResponse(result ?? { items: [], nextCursor: null });
};
