import * as syncAsyncExports from "@queuert/sync-async";
import { syncStep as __syncStep } from "@queuert/sync-async";

export const findRow = {
  sync: function findRowSync(db, key) {
    const [row] = __syncStep(db.query(key));
    return syncAsyncExports.isPromise(row) ? undefined : row;
  },
  async: async function findRowAsync(db, key) {
    const [row] = await db.query(key);
    return syncAsyncExports.isPromise(row) ? undefined : row;
  },
};
