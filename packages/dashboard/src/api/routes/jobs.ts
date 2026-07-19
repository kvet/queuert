import {
  type Client,
  JobNotFoundError,
  JobNotReschedulableError,
  withTransactionHooks,
} from "queuert";
import { helpersSymbol } from "queuert/internal";

import { serovalResponse } from "../response.js";
import {
  parseCursor,
  parseJobStatusFilter,
  parseLimit,
  parseOrderBy,
  parseOrderDirection,
  parseTypeNameFilter,
} from "./params.js";

export const handleJobsList = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const { status, blocked, continued } = parseJobStatusFilter(
    url.searchParams.get("status") ?? undefined,
  );
  const typeName = parseTypeNameFilter(url.searchParams.get("typeName") ?? undefined);
  const chainTypeName = parseTypeNameFilter(url.searchParams.get("chainTypeName") ?? undefined);
  const chainId = url.searchParams.get("chainId") ?? undefined;
  const id = url.searchParams.get("id") ?? undefined;
  const rawOrderBy = url.searchParams.get("orderBy") ?? undefined;
  const orderDirection = parseOrderDirection(url.searchParams.get("orderDirection") ?? undefined);
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);

  const listing =
    status === "pending"
      ? ({ status, orderBy: parseOrderBy(rawOrderBy, ["scheduledAt", "createdAt"]) } as const)
      : status === "running"
        ? ({
            status,
            orderBy: parseOrderBy(rawOrderBy, ["attemptAt", "attemptUntil", "createdAt"]),
          } as const)
        : status === "completed"
          ? ({ status, orderBy: parseOrderBy(rawOrderBy, ["completedAt", "createdAt"]) } as const)
          : ({ status: undefined, orderBy: parseOrderBy(rawOrderBy, ["createdAt"]) } as const);

  const common = {
    typeName,
    chainTypeName,
    chainId: chainId ? [chainId] : undefined,
    jobId: id ? [id] : undefined,
    orderDirection,
    cursor: parseCursor(url.searchParams.get("cursor") ?? undefined, {
      type: "timestampWithId",
      sortKey: listing.orderBy,
    }),
    limit,
  };

  const result =
    listing.status === "pending"
      ? await client.listJobs({
          ...common,
          status: listing.status,
          blocked,
          orderBy: listing.orderBy,
        })
      : listing.status === "running"
        ? await client.listJobs({ ...common, status: listing.status, orderBy: listing.orderBy })
        : listing.status === "completed"
          ? await client.listJobs({
              ...common,
              status: listing.status,
              continued,
              orderBy: listing.orderBy,
            })
          : await client.listJobs({ ...common, orderBy: listing.orderBy });

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

  const continuationId =
    job.status === "completed" && job.continuedToId !== null ? job.continuedToId : null;

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

export const handleJobReschedule = async (
  client: Client<any, any>,
  jobId: string,
): Promise<Response> => {
  try {
    const { stateAdapter } = client[helpersSymbol];
    const job = await stateAdapter.withTransaction(async (txCtx) =>
      withTransactionHooks(async (transactionHooks) =>
        client.rescheduleJob({ id: jobId, transactionHooks, ...txCtx }),
      ),
    );
    return serovalResponse({ job });
  } catch (err) {
    if (err instanceof JobNotFoundError) {
      return serovalResponse({ error: "Job not found" }, 404);
    }
    if (err instanceof JobNotReschedulableError) {
      return serovalResponse({ error: err.message }, 409);
    }
    throw err;
  }
};
