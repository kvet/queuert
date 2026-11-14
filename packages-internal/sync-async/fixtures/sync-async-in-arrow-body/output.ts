import { syncStep as __syncStep } from "@queuert/sync-async";

export const createFind = (db) =>
  ({
    sync: function (key) {
      return __syncStep(db.query(key));
    },
    async: async function (key) {
      return await db.query(key);
    },
  });
