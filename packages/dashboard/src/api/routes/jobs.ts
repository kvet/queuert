import {
  type Client,
  JobNotFoundError,
  JobNotTriggerableError,
  withTransactionHooks,
} from "queuert";
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
      jobChainTypeName: chainTypeName,
      jobChainId: chainId ? [chainId] : undefined,
      id: id ? [id] : undefined,
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

  const [blockers, chainJobs] = await Promise.all([
    client.getJobBlockers({ jobId: job.id }),
    client.listJobs({
      filter: { jobChainId: [job.chainId] },
      orderDirection: "asc",
      limit: 1000,
    }),
  ]);

  const continuation = chainJobs.items.find((j) => j.chainIndex === job.chainIndex + 1);

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
    const job = await withTransactionHooks(async (transactionHooks) =>
      client.triggerJob({ id: jobId, transactionHooks }),
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
