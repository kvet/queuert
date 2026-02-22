import { type StateAdapter } from "queuert";
import { serializeJob } from "../../shared/job.js";
import { parseCursor, parseLimit, parseStatusFilter, parseTypeNameFilter } from "./params.js";

export const handleJobsList = async (
  url: URL,
  stateAdapter: StateAdapter<any, any>,
): Promise<Response> => {
  const status = parseStatusFilter(url.searchParams.get("status") ?? undefined);
  const typeName = parseTypeNameFilter(url.searchParams.get("typeName") ?? undefined);
  const chainId = url.searchParams.get("chainId") ?? undefined;
  const id = url.searchParams.get("id") ?? undefined;
  const cursor = parseCursor(url.searchParams.get("cursor") ?? undefined);
  const limit = parseLimit(url.searchParams.get("limit") ?? undefined);

  const result = await stateAdapter.listJobs({
    filter: { status, typeName, chainId, id },
    page: { cursor, limit },
  });

  return Response.json({
    items: result.items.map(serializeJob),
    nextCursor: result.nextCursor,
  });
};

export const handleJobDetail = async (
  _url: URL,
  stateAdapter: StateAdapter<any, any>,
  jobId: string,
): Promise<Response> => {
  const job = await stateAdapter.getJobById({ jobId });
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const [blockers, chainJobs] = await Promise.all([
    stateAdapter.getJobBlockers({ jobId }),
    stateAdapter.listJobs({
      filter: { chainId: job.chainId },
      page: { limit: 1000 },
    }),
  ]);

  const continuation = chainJobs.items.find((j) => j.chainIndex === job.chainIndex + 1);

  return Response.json({
    job: serializeJob(job),
    continuation: continuation ? serializeJob(continuation) : null,
    blockers: blockers.map(([rootJob, lastJob]) => [
      serializeJob(rootJob),
      lastJob ? serializeJob(lastJob) : null,
    ]),
  });
};
