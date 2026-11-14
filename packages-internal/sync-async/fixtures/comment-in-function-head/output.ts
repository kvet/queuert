import { syncStep as __syncStep } from "@queuert/sync-async";

export const close = {
  sync: function /* closes the connection */ closeSync(db) {
    __syncStep(db.close());
  },
  async: async function /* closes the connection */ closeAsync(db) {
    await db.close();
  },
};
