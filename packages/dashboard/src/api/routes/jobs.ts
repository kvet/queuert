import { Hono } from "hono";
import { type StateAdapter, type StateJobStatus } from "queuert";
import { serializeJob } from "../serialize.js";

const parseStatusFilter = (raw: string | undefined): StateJobStatus[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? (values as StateJobStatus[]) : undefined;
};

const parseTypeNameFilter = (raw: string | undefined): string[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
};

export const createJobRoutes = (stateAdapter: StateAdapter<any, any>): Hono => {
  const app = new Hono();

  app.get("/", async (c) => {
    const status = parseStatusFilter(c.req.query("status"));
    const typeName = parseTypeNameFilter(c.req.query("typeName"));
    const chainId = c.req.query("chainId");
    const id = c.req.query("id") ?? undefined;
    const cursor = c.req.query("cursor");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 100);

    const result = await stateAdapter.listJobs({
      filter: { status, typeName, chainId, id },
      page: { cursor, limit },
    });

    return c.json({
      items: result.items.map(serializeJob),
      nextCursor: result.nextCursor,
    });
  });

  app.get("/:jobId", async (c) => {
    const jobId = c.req.param("jobId");

    const job = await stateAdapter.getJobById({ jobId });
    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    const [blockers, chainJobs] = await Promise.all([
      stateAdapter.getJobBlockers({ jobId }),
      stateAdapter.listJobs({
        filter: { chainId: job.chainId },
        page: { limit: 1000 },
      }),
    ]);

    const continuation = chainJobs.items.find((j) => j.originId === job.id);

    return c.json({
      job: serializeJob(job),
      continuation: continuation ? serializeJob(continuation) : null,
      blockers: blockers.map(([rootJob, lastJob]) => [
        serializeJob(rootJob),
        lastJob ? serializeJob(lastJob) : null,
      ]),
    });
  });

  return app;
};
