import {
  type Client,
  JobNotFoundError,
  JobNotTriggerableError,
  withTransactionHooks,
} from "queuert";
import { helpersSymbol } from "queuert/internal";

import { serovalResponse } from "../response.js";
import { parseCursor, parseLimit, parseStatusFilter, parseTypeNameFilter } from "./params.js";

export const handleJobsList = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const status = parseStatusFilter(url.searchParams.get("status") ?? undefined);
  const typeName = parseTypeNameFilter(url.searchParams.get("typeName") ?? undefined);
  const chainTypeName = parseTypeNameFilter(url.searchParams.get("chainTypeName") ?? undefined);
  const chainId = url.searchParams.get("chainId") ?? undefined;
  const id = url.searchParams.get("id") ?? undefined;
  const cursor = parseCursor(url.searchParams.get("cursor") ?? undefined);
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);

  const result = await client.listJobs({
    filter: {
      status,
      typeName,
      chainTypeName,
      chainId: chainId ? [chainId] : undefined,
      jobId: id ? [id] : undefined,
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

export const handleJobDetail = async (
  _url: URL,
  client: Client<any, any>,
  jobId: string,
): Promise<Response> => {
  const job = await client.getJob({ id: jobId });
  if (!job) {
    return serovalResponse({ error: "Job not found" }, 404);
  }

  const continuationId = (job as { continuedToJobId?: string | null }).continuedToJobId ?? null;

  const [blockers, continuation] = await Promise.all([
    client.getJobBlockers({ jobId: job.id }),
    continuationId ? client.getJob({ id: continuationId }) : Promise.resolve(null),
  ]);

  return serovalResponse({
    job,
    continuation: continuation ?? null,
    blockers,
  });
};

export const handleJobTrigger = async (
  client: Client<any, any>,
  jobId: string,
): Promise<Response> => {
  try {
    const { stateAdapter } = client[helpersSymbol];
    const job = await stateAdapter.withTransaction(async (txCtx) =>
      withTransactionHooks(async (transactionHooks) =>
        client.triggerJob({ id: jobId, transactionHooks, ...txCtx }),
      ),
    );
    return serovalResponse({ job });
  } catch (err) {
    if (err instanceof JobNotFoundError) {
      return serovalResponse({ error: "Job not found" }, 404);
    }
    if (err instanceof JobNotTriggerableError) {
      return serovalResponse({ error: err.message }, 409);
    }
    throw err;
  }
};
