import { RpcError } from "@queuert/rpc";
import type { ServerFn } from "@queuert/rpc/server";
import { BlockerReferenceError, type Page } from "queuert";
import { helpersSymbol } from "queuert/internal";
import * as v from "valibot";

import type { UnknownChain, UnknownJob } from "../../shared/types.ts";
import { type DashboardClient, createServerFn } from "../createServerFn.ts";
import {
  checkCursor,
  DEFAULT_PAGE_LIMIT,
  id,
  ids,
  orderByFor,
  orderDirection,
  pageLimit,
  typeNames,
  type PageArguments,
  pageArguments,
} from "./arguments.ts";
import { lookupEachOrNotFound, lookupOrNotFound } from "./lookup.ts";

type ChainJobsPage = {
  jobs: UnknownJob[];
  jobBlockers: Record<string, UnknownChain[]>;
  nextCursor: string | null;
};

type DeleteChainOutcome = { outcome: "deleted"; count: number } | { outcome: "blocked" };

const chainNotFound = () => new RpcError("Chain not found", { status: 404 });

const listChainJobsWithBlockers = async (
  client: DashboardClient,
  chainId: string,
  options: { cursor?: string; limit: number },
): Promise<ChainJobsPage> => {
  const jobs = await client.listChainJobs({
    chainId,
    orderDirection: "asc",
    cursor: options.cursor,
    limit: options.limit,
  });

  const jobBlockers = await Promise.all(
    jobs.items.map(async (job) => {
      const blockers = await client.getJobBlockers({ jobId: job.id });
      return [job.id, blockers] as const;
    }),
  );

  return {
    jobs: jobs.items,
    jobBlockers: Object.fromEntries(jobBlockers),
    nextCursor: jobs.nextCursor,
  };
};

export const listChains: ServerFn<
  {
    typeName: string;
    status?: "running" | "completed";
    independent?: boolean;
    orderBy?: string;
    orderDirection?: "asc" | "desc";
  } & PageArguments,
  Page<UnknownChain>
> = createServerFn()
  .inputValidator(
    v.strictObject({
      typeName: id,
      status: v.optional(v.picklist(["running", "completed"])),
      independent: v.optional(v.boolean()),
      orderBy: v.optional(v.string()),
      orderDirection: v.optional(orderDirection, "desc"),
      ...pageArguments,
    }),
  )
  .handler(async ({ data, client }) => {
    const listing =
      data.status === "completed"
        ? ({
            status: data.status,
            orderBy: orderByFor(data.orderBy, ["completedAt", "createdAt"]),
          } as const)
        : ({ status: data.status, orderBy: orderByFor(data.orderBy, ["createdAt"]) } as const);

    const result = await client.listChains({
      typeName: data.typeName,
      independent: data.independent,
      orderDirection: data.orderDirection,
      cursor: checkCursor(data.cursor, { type: "timestampWithId", sortKey: listing.orderBy }),
      limit: data.limit,
      ...listing,
    });
    return result;
  });

export const getChainDetail: ServerFn<
  { id: string; limit?: number },
  { chain: UnknownChain; currentJob: UnknownJob | null } & ChainJobsPage
> = createServerFn()
  .inputValidator(v.strictObject({ id, limit: v.optional(pageLimit, DEFAULT_PAGE_LIMIT) }))
  .handler(async ({ data, client }) => {
    const chain: UnknownChain | undefined = await lookupOrNotFound(client, async () =>
      client.getChain({ id: data.id }),
    );
    if (!chain) throw chainNotFound();

    const page = await listChainJobsWithBlockers(client, data.id, { limit: data.limit });

    let currentJob: UnknownJob | null = null;
    if (chain.status !== "completed") {
      const tailJob =
        page.nextCursor === null
          ? page.jobs.at(-1)
          : (await client.listChainJobs({ chainId: data.id, orderDirection: "desc", limit: 1 }))
              .items[0];
      currentJob = tailJob ?? null;
    }

    return { chain, currentJob, ...page };
  });

export const listChainJobs: ServerFn<{ chainId: string } & PageArguments, ChainJobsPage> =
  createServerFn()
    .inputValidator(
      v.strictObject({
        chainId: id,
        ...pageArguments,
      }),
    )
    .handler(async ({ data, client }) => {
      const validCursor = checkCursor(data.cursor, { type: "id" });
      const page = await lookupOrNotFound(client, async () =>
        listChainJobsWithBlockers(client, data.chainId, { cursor: validCursor, limit: data.limit }),
      );
      if (!page) throw chainNotFound();
      return page;
    });

export const listBlockedJobs: ServerFn<
  { chainId: string } & PageArguments,
  Page<UnknownJob>
> = createServerFn()
  .inputValidator(
    v.strictObject({
      chainId: id,
      ...pageArguments,
    }),
  )
  .handler(async ({ data, client }) => {
    const validCursor = checkCursor(data.cursor, {
      type: "timestampWithId",
      sortKey: "createdAt",
    });
    const result = await lookupOrNotFound(client, async () =>
      client.listBlockedJobs({
        chainId: data.chainId,
        orderDirection: "desc",
        cursor: validCursor,
        limit: data.limit,
      }),
    );
    if (!result) throw chainNotFound();
    return result;
  });

const deleteChainNow = async (
  client: DashboardClient,
  chainId: string,
): Promise<DeleteChainOutcome> => {
  try {
    // oxlint-disable-next-line typescript/promise-function-async -- runs in the client's mode: a sync state adapter rejects an async callback
    const deleted = await client[helpersSymbol].stateAdapter.withTransaction((txCtx) =>
      client.deleteChains({ ids: [chainId], ...txCtx }),
    );
    return { outcome: "deleted", count: deleted.length };
  } catch (err) {
    if (err instanceof BlockerReferenceError) return { outcome: "blocked" };
    throw err;
  }
};

export const deleteChain: ServerFn<{ id: string }, { deleted: Promise<DeleteChainOutcome> }> =
  createServerFn()
    .inputValidator(v.strictObject({ id }))
    .handler(async ({ data, client }) => {
      const chain = await lookupOrNotFound(client, async () => client.getChain({ id: data.id }));
      if (!chain) throw chainNotFound();
      return { deleted: deleteChainNow(client, data.id) };
    });

export const getChainTypeNames: ServerFn<undefined, string[]> = createServerFn().handler(
  async ({ client }) => client.getChainTypeNames(),
);

export const countChainsByTypeName: ServerFn<
  { typeNames: string[] },
  {
    typeName: string;
    running: { count: number; hasMore: boolean };
    completed: { count: number; hasMore: boolean };
  }[]
> = createServerFn()
  .inputValidator(v.strictObject({ typeNames }))
  .handler(async ({ data, client }) => {
    if (data.typeNames.length === 0) return [];
    const counts = await client.countChainsByTypeName({ typeNames: data.typeNames });
    return data.typeNames.map((typeName, index) => ({ typeName, ...counts[index] }));
  });

export const getChains: ServerFn<{ ids: string[] }, UnknownChain[]> = createServerFn()
  .inputValidator(v.strictObject({ ids }))
  .handler(async ({ data, client }) => {
    if (data.ids.length === 0) return [];
    return lookupEachOrNotFound(client, data.ids, async (batch) =>
      client.getChains({ ids: batch }),
    );
  });
