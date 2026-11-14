import { type SyncAsync, syncStep as __syncStep } from "@queuert/sync-async";

import { countAll } from "./count-all.ts";

export const countJobs: SyncAsync<[db: Db, typeName: string], number> = {
  sync: function countJobsSync(
    db: Db,
    typeName: string,
  ) {
    const rows = __syncStep(db.query<{ count: number }>("SELECT count(*) AS count", [typeName]));
    return rows[0]!.count;
  },
  async: async function countJobsAsync(
    db: Db,
    typeName: string,
  ) {
    const rows = await db.query<{ count: number }>("SELECT count(*) AS count", [typeName]);
    return rows[0]!.count;
  },
};
