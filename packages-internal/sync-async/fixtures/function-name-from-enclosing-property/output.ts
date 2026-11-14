import { syncStep as __syncStep } from "@queuert/sync-async";

export const createClient = (db, runInMode) => ({
  findRow: (key) =>
    runInMode(
      {
        sync: function findRowSync() {
          return __syncStep(db.query(key));
        },
        async: async function findRowAsync() {
          return await db.query(key);
        },
      },
    ),
});
