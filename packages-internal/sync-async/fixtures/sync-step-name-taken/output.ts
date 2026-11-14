import { syncStep as __syncStep1 } from "@queuert/sync-async";

const __syncStep = "taken";

export const findRow = {
  sync: function findRowSync(db, key) {
    const [row] = __syncStep1(db.query(key, __syncStep));
    return row;
  },
  async: async function findRowAsync(db, key) {
    const [row] = await db.query(key, __syncStep);
    return row;
  },
};
