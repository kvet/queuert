import { type StateAdapter } from "queuert";
import { serializeJob } from "../../shared/job.js";
import { parseCursor, parseLimit, parseTypeNameFilter } from "./params.js";

export const handleChainsList = async (
  url: URL,
  stateAdapter: StateAdapter<any, any>,
): Promise<Response> => {
  const typeName = parseTypeNameFilter(url.searchParams.get("typeName") ?? undefined);
  const rootOnly = url.searchParams.get("rootOnly") !== "false";
  const id = url.searchParams.get("id") ?? undefined;
  const cursor = parseCursor(url.searchParams.get("cursor") ?? undefined);
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);

  const result = await stateAdapter.listChains({
    filter: { typeName, rootOnly, id },
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
  const chain = await stateAdapter.getJobChainById({ jobId: chainId });
  if (!chain) {
    return Response.json({ error: "Chain not found" }, { status: 404 });
  }

  const jobs = await stateAdapter.listJobs({
    filter: { chainId },
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
  const jobs = await stateAdapter.getJobsBlockedByChain({ chainId });

  return Response.json({
    items: jobs.map(serializeJob),
  });
};
