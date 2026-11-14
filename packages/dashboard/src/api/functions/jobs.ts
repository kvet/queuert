import { RpcError } from "@queuert/rpc";
import type { ServerFn } from "@queuert/rpc/server";
import { JobNotFoundError, JobNotReschedulableError, type Page } from "queuert";
import { helpersSymbol } from "queuert/internal";
import * as v from "valibot";

import type { UnknownChain, UnknownJob } from "../../shared/types.ts";
import { createServerFn } from "../createServerFn.ts";
import {
  checkCursor,
  id,
  ids,
  orderByFor,
  orderDirection,
  typeNames,
  type PageArguments,
  pageArguments,
} from "./arguments.ts";
import { lookupEachOrNotFound, lookupOrNotFound } from "./lookup.ts";

const jobNotFound = () => new RpcError("Job not found", { status: 404 });

export const listJobs: ServerFn<
  {
    typeName: string;
    status?: "blocked" | "pending" | "running" | "completed";
    orderBy?: string;
    orderDirection?: "asc" | "desc";
  } & PageArguments,
  Page<UnknownJob>
> = createServerFn()
  .inputValidator(
    v.strictObject({
      typeName: id,
      status: v.optional(v.picklist(["blocked", "pending", "running", "completed"])),
      orderBy: v.optional(v.string()),
      orderDirection: v.optional(orderDirection, "desc"),
      ...pageArguments,
    }),
  )
  .handler(async ({ data, client }) => {
    const listing =
      data.status === "blocked" || data.status === "pending"
        ? ({
            status: data.status,
            orderBy: orderByFor(data.orderBy, ["scheduledAt", "createdAt"]),
          } as const)
        : data.status === "running"
          ? ({
              status: data.status,
              orderBy: orderByFor(data.orderBy, ["attemptAt", "createdAt"]),
            } as const)
          : data.status === "completed"
            ? ({
                status: data.status,
                orderBy: orderByFor(data.orderBy, ["completedAt", "createdAt"]),
              } as const)
            : ({ status: undefined, orderBy: orderByFor(data.orderBy, ["createdAt"]) } as const);

    const result = await client.listJobs({
      typeName: data.typeName,
      orderDirection: data.orderDirection,
      cursor: checkCursor(data.cursor, { type: "timestampWithId", sortKey: listing.orderBy }),
      limit: data.limit,
      ...listing,
    });
    return result;
  });

export const getJobTypeNames: ServerFn<undefined, string[]> = createServerFn().handler(
  async ({ client }) => client.getJobTypeNames(),
);

export const countJobsByTypeName: ServerFn<
  { typeNames: string[] },
  {
    typeName: string;
    blocked: { count: number; hasMore: boolean };
    pending: { count: number; hasMore: boolean };
    running: { count: number; hasMore: boolean };
    completed: { count: number; hasMore: boolean };
    workers: { live: number; expired: number };
  }[]
> = createServerFn()
  .inputValidator(v.strictObject({ typeNames }))
  .handler(async ({ data, client }) => {
    if (data.typeNames.length === 0) return [];
    const [counts, workerCounts] = await Promise.all([
      client.countJobsByTypeName({ typeNames: data.typeNames }),
      client.countWorkersByTypeName({ typeNames: data.typeNames }),
    ]);
    return data.typeNames.map((typeName, index) => ({
      typeName,
      ...counts[index],
      workers: workerCounts[index],
    }));
  });

export const getJobs: ServerFn<{ ids: string[] }, UnknownJob[]> = createServerFn()
  .inputValidator(v.strictObject({ ids }))
  .handler(async ({ data, client }) => {
    if (data.ids.length === 0) return [];
    return lookupEachOrNotFound(client, data.ids, async (batch) => client.getJobs({ ids: batch }));
  });

export const getJobDetail: ServerFn<
  { id: string },
  { job: UnknownJob; continuation: UnknownJob | null; blockers: UnknownChain[] }
> = createServerFn()
  .inputValidator(v.strictObject({ id }))
  .handler(async ({ data, client }) => {
    const job = await lookupOrNotFound(client, async () => client.getJob({ id: data.id }));
    if (!job) throw jobNotFound();

    const continuationId =
      job.status === "completed" && job.continuedToId !== null ? job.continuedToId : null;

    const [blockers, continuation] = await Promise.all([
      Promise.resolve(client.getJobBlockers({ jobId: job.id })),
      continuationId ? client.getJob({ id: continuationId }) : Promise.resolve(undefined),
    ]);

    return { job, continuation: continuation ?? null, blockers };
  });

export const rescheduleJob: ServerFn<{ id: string }, UnknownJob> = createServerFn()
  .inputValidator(v.strictObject({ id }))
  .handler(async ({ data, client }) => {
    try {
      // oxlint-disable-next-line typescript/promise-function-async -- runs in the client's mode: a sync state adapter rejects an async callback
      return await client[helpersSymbol].stateAdapter.withTransaction((txCtx) =>
        client.rescheduleJob({ id: data.id, ...txCtx }),
      );
    } catch (err) {
      if (err instanceof JobNotFoundError) throw jobNotFound();
      if (err instanceof JobNotReschedulableError) {
        throw new RpcError(err.message, { status: 409, cause: err });
      }
      const job = await lookupOrNotFound(client, async () => client.getJob({ id: data.id }));
      if (job !== undefined) {
        // oxlint-disable-next-line typescript/only-throw-error -- re-throwing the original adapter error
        throw err;
      }
      throw jobNotFound();
    }
  });
