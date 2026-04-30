import { BlockerReferenceError, type Client, withTransactionHooks } from "queuert";
import { helpersSymbol } from "queuert/internal";

import { serovalResponse } from "../response.js";
import { parseCursor, parseLimit, parseStatusFilter, parseTypeNameFilter } from "./params.js";

export const handleChainsList = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const typeName = parseTypeNameFilter(url.searchParams.get("typeName") ?? undefined);
  const status = parseStatusFilter(url.searchParams.get("status") ?? undefined);
  const root = url.searchParams.get("root") !== "false";
  const id = url.searchParams.get("id") ?? undefined;
  const jobId = url.searchParams.get("jobId") ?? undefined;
  const cursor = parseCursor(url.searchParams.get("cursor") ?? undefined);
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);

  const result = await client.listChains({
    filter: {
      typeName,
      status,
      root,
      chainId: id ? [id] : undefined,
      jobId: jobId ? [jobId] : undefined,
    },
    orderDirection: "desc",
    cursor,
    limit,
  });

  return serovalResponse({
    items: result.items,
    nextCursor: result.nextCursor,
  });
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

  const jobs = await client.listChainJobs({
    chainId,
    orderDirection: "asc",
    limit: 1000,
  });

  const jobBlockers = await Promise.all(
    jobs.items.map(async (job) => {
      const blockers = await client.getJobBlockers({ jobId: job.id });
      return [job.id, blockers] as const;
    }),
  );

  return serovalResponse({
    chain,
    jobs: jobs.items,
    jobBlockers: Object.fromEntries(jobBlockers),
  });
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
  _url: URL,
  client: Client<any, any>,
  chainId: string,
): Promise<Response> => {
  const result = await client.listBlockedJobs({
    chainId,
    orderDirection: "desc",
    limit: 1000,
  });

  return serovalResponse({ items: result.items });
};
