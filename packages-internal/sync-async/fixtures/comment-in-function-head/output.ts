import { syncStep as __syncStep } from "@queuert/sync-async";

export const close = {
  sync: function /* closes the connection */ (db) {
    __syncStep(db.close());
  },
  async: async function /* closes the connection */ (db) {
    await db.close();
  },
};
