import { syncStep as __syncStep } from "@queuert/sync-async";

export const createFind = (db) =>
  ({
    sync: function createFindSync(key) {
      return __syncStep(db.query(key));
    },
    async: async function createFindAsync(key) {
      return await db.query(key);
    },
  });
