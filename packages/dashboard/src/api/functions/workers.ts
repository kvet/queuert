import { RpcError } from "@queuert/rpc";
import type { ServerFn } from "@queuert/rpc/server";
import type { Client, Page, Worker } from "queuert";
import * as v from "valibot";

import type { UnknownJob, WorkerWithRunningJobs } from "../../shared/types.ts";
import { createServerFn } from "../createServerFn.ts";
import { checkCursor, id, ids, type PageArguments, pageArguments } from "./arguments.ts";
import { lookupEachOrNotFound, lookupOrNotFound } from "./lookup.ts";

const withRunningJobCounts = async (
  client: Client<any, any>,
  workers: Worker<string>[],
): Promise<WorkerWithRunningJobs[]> => {
  const counts = await client.countRunningJobsByWorkerId({
    workerIds: workers.map((worker) => worker.id),
  });
  return workers.map((worker, index) => ({ ...worker, runningJobCount: counts[index] }));
};

export const listWorkers: ServerFn<
  { typeName?: string } & PageArguments,
  Page<WorkerWithRunningJobs>
> = createServerFn()
  .inputValidator(
    v.strictObject({
      typeName: v.optional(id),
      ...pageArguments,
    }),
  )
  .handler(async ({ data, client }) => {
    const result = await client.listWorkers({
      typeName: data.typeName,
      cursor: checkCursor(data.cursor, { type: "timestampWithId", sortKey: "startedAt" }),
      limit: data.limit,
    });
    return {
      items: await withRunningJobCounts(client, result.items),
      nextCursor: result.nextCursor,
    };
  });

export const countWorkers: ServerFn<undefined, { live: number; expired: number }> =
  createServerFn().handler(async ({ client }) => client.countWorkers());

export const getWorkers: ServerFn<{ ids: string[] }, WorkerWithRunningJobs[]> = createServerFn()
  .inputValidator(v.strictObject({ ids }))
  .handler(async ({ data, client }) => {
    if (data.ids.length === 0) return [];
    const workers = await lookupEachOrNotFound(client, data.ids, async (batch) =>
      client.getWorkers({ ids: batch }),
    );
    return withRunningJobCounts(client, workers);
  });

export const getWorker: ServerFn<{ id: string }, WorkerWithRunningJobs> = createServerFn()
  .inputValidator(v.strictObject({ id }))
  .handler(async ({ data, client }) => {
    const worker = await lookupOrNotFound(client, async () => client.getWorker({ id: data.id }));
    if (!worker) throw new RpcError("Worker not found", { status: 404 });
    const [workerWithCount] = await withRunningJobCounts(client, [worker]);
    return workerWithCount;
  });

export const listWorkerJobs: ServerFn<
  { workerId: string } & PageArguments,
  Page<UnknownJob>
> = createServerFn()
  .inputValidator(
    v.strictObject({
      workerId: id,
      ...pageArguments,
    }),
  )
  .handler(async ({ data, client }) => {
    const validCursor = checkCursor(data.cursor, { type: "timestampWithId", sortKey: "attemptAt" });
    const result = await lookupOrNotFound(client, async () =>
      client.listWorkerJobs({ workerId: data.workerId, cursor: validCursor, limit: data.limit }),
    );
    return result ?? { items: [], nextCursor: null };
  });
