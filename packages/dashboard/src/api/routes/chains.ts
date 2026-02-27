import { type StateAdapter } from "queuert";
import { serializeJob } from "../../shared/job.js";
import { parseCursor, parseLimit, parseStatusFilter, parseTypeNameFilter } from "./params.js";

export const handleChainsList = async (
  url: URL,
  stateAdapter: StateAdapter<any, any>,
): Promise<Response> => {
  const typeName = parseTypeNameFilter(url.searchParams.get("typeName") ?? undefined);
  const status = parseStatusFilter(url.searchParams.get("status") ?? undefined);
  const rootOnly = url.searchParams.get("rootOnly") !== "false";
  const id = url.searchParams.get("id") ?? undefined;
  const jobId = url.searchParams.get("jobId") ?? undefined;
  const cursor = parseCursor(url.searchParams.get("cursor") ?? undefined);
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);

  const result = await stateAdapter.listJobChains({
    filter: {
      typeName,
      status,
      rootOnly,
      chainId: id ? [id] : undefined,
      jobId: jobId ? [jobId] : undefined,
    },
    orderDirection: "desc",
    page: { cursor, limit },
  });

  return Response.json({
    items: result.items.map(([rootJob, lastJob]) => [
      serializeJob(rootJob),
      lastJob ? serializeJob(lastJob) : null,
    ]),
    nextCursor: result.nextCursor,
  });
};

export const handleChainDetail = async (
  url: URL,
  stateAdapter: StateAdapter<any, any>,
  chainId: string,
): Promise<Response> => {
  const chain = await stateAdapter.getJobChainById({ chainId });
  if (!chain) {
    return Response.json({ error: "Chain not found" }, { status: 404 });
  }

  const jobs = await stateAdapter.listJobChainJobs({
    chainId,
    orderDirection: "asc",
    page: { limit: 1000 },
  });

  const jobBlockers = await Promise.all(
    jobs.items.map(async (job) => {
      const blockers = await stateAdapter.getJobBlockers({ jobId: job.id });
      return [
        job.id,
        blockers.map(([rootJob, lastJob]) => [
          serializeJob(rootJob),
          lastJob ? serializeJob(lastJob) : null,
        ]),
      ] as const;
    }),
  );

  return Response.json({
    rootJob: serializeJob(chain[0]),
    lastJob: chain[1] ? serializeJob(chain[1]) : null,
    jobs: jobs.items.map(serializeJob),
    jobBlockers: Object.fromEntries(jobBlockers),
  });
};

export const handleChainBlocking = async (
  _url: URL,
  stateAdapter: StateAdapter<any, any>,
  chainId: string,
): Promise<Response> => {
  const result = await stateAdapter.listBlockedJobs({
    chainId,
    orderDirection: "desc",
    page: { limit: 1000 },
  });

  return Response.json({
    items: result.items.map(serializeJob),
  });
};
