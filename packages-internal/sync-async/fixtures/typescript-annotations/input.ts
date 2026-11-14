import { type SyncAsync, syncAsync, step } from "@queuert/sync-async";

import { countAll } from "./count-all.ts";

export const countJobs: SyncAsync<[db: Db, typeName: string], number> = syncAsync(function* (
  db: Db,
  typeName: string,
): ReturnType<typeof countAll.steps> {
  const rows = yield* step(db.query<{ count: number }>("SELECT count(*) AS count", [typeName]));
  return rows[0]!.count;
});
