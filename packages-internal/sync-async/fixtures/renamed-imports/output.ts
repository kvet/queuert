import { syncStep as __syncStep } from "@queuert/sync-async";

export const close = {
  sync: function closeSync(db) {
    __syncStep(db.close());
  },
  async: async function closeAsync(db) {
    await db.close();
  },
};
