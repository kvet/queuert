import { syncStep as __syncStep } from "@queuert/sync-async";

export const findRow = {
  sync: function lookup(db, key) {
    return __syncStep(db.query(key));
  },
  async: async function lookup(db, key) {
    return await db.query(key);
  },
};
