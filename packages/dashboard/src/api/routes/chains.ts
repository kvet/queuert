import { BlockerReferenceError, type Client, withTransactionHooks } from "queuert";
import { helpersSymbol } from "queuert/internal";

import { serovalResponse } from "../response.js";
import {
  parseChainStatusFilter,
  parseCursor,
  parseLimit,
  parseOrderBy,
  parseOrderDirection,
  parseTypeNameFilter,
} from "./params.js";

export const handleChainsList = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const typeName = parseTypeNameFilter(url.searchParams.get("typeName") ?? undefined);
  const status = parseChainStatusFilter(url.searchParams.get("status") ?? undefined);
  const independent = url.searchParams.get("independent") !== "false";
  const id = url.searchParams.get("id") ?? undefined;
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
    chainId: id ? [id] : undefined,
    orderDirection,
    cursor: parseCursor(url.searchParams.get("cursor") ?? undefined, {
      type: "timestampWithId",
      sortKey: listing.orderBy,
    }),
    limit,
  };

  const result =
    listing.status === "completed"
      ? await client.listChains({ ...common, status: listing.status, orderBy: listing.orderBy })
      : listing.status === "running"
        ? await client.listChains({ ...common, status: listing.status, orderBy: listing.orderBy })
        : await client.listChains({ ...common, orderBy: listing.orderBy });

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
  const chain = await client.getChain({ id: chainId });
  if (!chain) {
    return serovalResponse({ error: "Chain not found" }, 404);
  }

  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);
  const page = await listChainJobsWithBlockers(client, chainId, { limit });

  return serovalResponse({ chain, ...page });
};

export const handleChainJobs = async (
  url: URL,
  client: Client<any, any>,
  chainId: string,
): Promise<Response> => {
  const cursor = parseCursor(url.searchParams.get("cursor") ?? undefined, { type: "id" });
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);
  const page = await listChainJobsWithBlockers(client, chainId, { cursor, limit });

  return serovalResponse(page);
};

export const handleChainDelete = async (
  client: Client<any, any>,
  chainId: string,
  options?: { cascade?: boolean },
): Promise<Response> => {
  const chain = await client.getChain({ id: chainId });
  if (!chain) {
    return serovalResponse({ error: "Chain not found" }, 404);
  }

  try {
    const { stateAdapter } = client[helpersSymbol];
    const deleted = await stateAdapter.withTransaction(async (txCtx) =>
      withTransactionHooks(async (transactionHooks) =>
        client.deleteChains({
          ids: [chainId],
          cascade: options?.cascade,
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
  const result = await client.listBlockedJobs({
    chainId,
    orderDirection: "desc",
    cursor,
    limit,
  });

  return serovalResponse({ items: result.items, nextCursor: result.nextCursor });
};
