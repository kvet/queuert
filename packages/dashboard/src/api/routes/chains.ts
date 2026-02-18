import { Hono } from "hono";
import { type StateAdapter } from "queuert";
import { serializeJob } from "../serialize.js";

const parseTypeNameFilter = (raw: string | undefined): string[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
};

export const createChainRoutes = (stateAdapter: StateAdapter<any, any>): Hono => {
  const app = new Hono();

  app.get("/", async (c) => {
    const typeName = parseTypeNameFilter(c.req.query("typeName"));
    const rootOnly = c.req.query("rootOnly") !== "false";
    const id = c.req.query("id") ?? undefined;
    const cursor = c.req.query("cursor");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 100);

    const result = await stateAdapter.listChains({
      filter: { typeName, rootOnly, id },
      page: { cursor, limit },
    });

    return c.json({
      items: result.items.map(([rootJob, lastJob]) => [
        serializeJob(rootJob),
        lastJob ? serializeJob(lastJob) : null,
      ]),
      nextCursor: result.nextCursor,
    });
  });

  app.get("/:chainId", async (c) => {
    const chainId = c.req.param("chainId");

    const chain = await stateAdapter.getJobChainById({ jobId: chainId });
    if (!chain) {
      return c.json({ error: "Chain not found" }, 404);
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

    return c.json({
      rootJob: serializeJob(chain[0]),
      lastJob: chain[1] ? serializeJob(chain[1]) : null,
      jobs: jobs.items.map(serializeJob),
      jobBlockers: Object.fromEntries(jobBlockers),
    });
  });

  app.get("/:chainId/blocking", async (c) => {
    const chainId = c.req.param("chainId");

    const jobs = await stateAdapter.getJobsBlockedByChain({ chainId });

    return c.json({
      items: jobs.map(serializeJob),
    });
  });

  return app;
};
