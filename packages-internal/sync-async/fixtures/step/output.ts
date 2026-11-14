import { syncStep as __syncStep } from "@queuert/sync-async";

export const findRow = {
  sync: function findRowSync(db, key) {
    const [row] = __syncStep(db.query(key));
    return row;
  },
  async: async function findRowAsync(db, key) {
    const [row] = await db.query(key);
    return row;
  },
};
