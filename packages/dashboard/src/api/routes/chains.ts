import { BlockerReferenceError, type Client, withTransactionHooks } from "queuert";
import { helpersSymbol } from "queuert/internal";

import { serovalResponse } from "../response.js";
import { MAX_IDS, lookupEachOrNotFound, lookupOrNotFound, parseIds } from "./lookup.js";
import {
  parseChainStatusFilter,
  parseCursor,
  parseLimit,
  parseOrderBy,
  parseOrderDirection,
} from "./params.js";

export const handleChainsList = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const typeName = url.searchParams.get("typeName");
  if (!typeName) return serovalResponse({ items: [], nextCursor: null });

  const status = parseChainStatusFilter(url.searchParams.get("status") ?? undefined);
  const rawIndependent = url.searchParams.get("independent");
  const independent =
    rawIndependent === "true" ? true : rawIndependent === "false" ? false : undefined;
  const rawOrderBy = url.searchParams.get("orderBy") ?? undefined;
  const orderDirection = parseOrderDirection(url.searchParams.get("orderDirection") ?? undefined);
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);

  const listing =
    status === "completed"
      ? ({ status, orderBy: parseOrderBy(rawOrderBy, ["completedAt", "createdAt"]) } as const)
      : status === "running"
        ? ({ status, orderBy: parseOrderBy(rawOrderBy, ["createdAt"]) } as const)
        : ({ status: undefined, orderBy: parseOrderBy(rawOrderBy, ["createdAt"]) } as const);

  const common = {
    typeName,
    independent,
    orderDirection,
    cursor: parseCursor(url.searchParams.get("cursor") ?? undefined, {
      type: "timestampWithId",
      sortKey: listing.orderBy,
    }),
    limit,
  };

  const result = await client.listChains({ ...common, ...listing });

  return serovalResponse({
    items: result.items,
    nextCursor: result.nextCursor,
  });
};

const listChainJobsWithBlockers = async (
  client: Client<any, any>,
  chainId: string,
  options: { cursor?: string; limit: number },
) => {
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

export const handleChainDetail = async (
  url: URL,
  client: Client<any, any>,
  chainId: string,
): Promise<Response> => {
  const chain = await lookupOrNotFound(client, async () => client.getChain({ id: chainId }));
  if (!chain) {
    return serovalResponse({ error: "Chain not found" }, 404);
  }

  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);
  const page = await listChainJobsWithBlockers(client, chainId, { limit });

  // A running chain's status says nothing about what it waits on; its tail job does.
  let currentJob = null;
  if (chain.status !== "completed") {
    const tailJob =
      page.nextCursor === null
        ? page.jobs.at(-1)
        : (await client.listChainJobs({ chainId, orderDirection: "desc", limit: 1 })).items[0];
    currentJob = tailJob ?? null;
  }

  return serovalResponse({ chain, currentJob, ...page });
};

export const handleChainJobs = async (
  url: URL,
  client: Client<any, any>,
  chainId: string,
): Promise<Response> => {
  const cursor = parseCursor(url.searchParams.get("cursor") ?? undefined, { type: "id" });
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);
  const page = await lookupOrNotFound(client, async () =>
    listChainJobsWithBlockers(client, chainId, { cursor, limit }),
  );
  if (!page) {
    return serovalResponse({ error: "Chain not found" }, 404);
  }

  return serovalResponse(page);
};

export const handleChainDelete = async (
  client: Client<any, any>,
  chainId: string,
): Promise<Response> => {
  const chain = await lookupOrNotFound(client, async () => client.getChain({ id: chainId }));
  if (!chain) {
    return serovalResponse({ error: "Chain not found" }, 404);
  }

  try {
    const { stateAdapter } = client[helpersSymbol];
    const deleted = await stateAdapter.withTransaction(async (txCtx) =>
      withTransactionHooks(async (transactionHooks) =>
        client.deleteChains({
          ids: [chainId],
          transactionHooks,
          ...txCtx,
        }),
      ),
    );
    return serovalResponse({ deleted });
  } catch (err) {
    if (err instanceof BlockerReferenceError) {
      return serovalResponse(
        { error: "Cannot delete: other jobs depend on this chain as a blocker" },
        409,
      );
    }
    throw err;
  }
};

export const handleChainTypesList = async (client: Client<any, any>): Promise<Response> => {
  const names = await client.listChainTypeNames();
  return serovalResponse(names);
};

export const handleChainTypesCounts = async (
  url: URL,
  client: Client<any, any>,
): Promise<Response> => {
  const raw = url.searchParams.get("typeNames") ?? "";
  const typeNames = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (typeNames.length === 0) return serovalResponse([]);
  const counts = await client.countByChainTypeNames({ typeNames });
  return serovalResponse(typeNames.map((typeName, i) => ({ typeName, ...counts[i] })));
};

export const handleChainsByIds = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const ids = parseIds(url.searchParams.get("ids"));
  if (ids.length > MAX_IDS) return serovalResponse({ error: `At most ${MAX_IDS} IDs` }, 400);
  if (ids.length === 0) return serovalResponse({ items: [], nextCursor: null });
  const items = await lookupEachOrNotFound(client, ids, async (batch) =>
    client.getChains({ ids: batch }),
  );
  return serovalResponse({ items, nextCursor: null });
};

export const handleChainBlocking = async (
  url: URL,
  client: Client<any, any>,
  chainId: string,
): Promise<Response> => {
  const cursor = parseCursor(url.searchParams.get("cursor") ?? undefined, {
    type: "timestampWithId",
    sortKey: "createdAt",
  });
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);
  const result = await lookupOrNotFound(client, async () =>
    client.listBlockedJobs({
      chainId,
      orderDirection: "desc",
      cursor,
      limit,
    }),
  );
  if (!result) {
    return serovalResponse({ error: "Chain not found" }, 404);
  }

  return serovalResponse({ items: result.items, nextCursor: result.nextCursor });
};
