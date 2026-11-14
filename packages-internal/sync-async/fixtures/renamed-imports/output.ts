import { syncStep as __syncStep } from "@queuert/sync-async";

export const close = {
  sync: function (db) {
    __syncStep(db.close());
  },
  async: async function (db) {
    await db.close();
  },
};
