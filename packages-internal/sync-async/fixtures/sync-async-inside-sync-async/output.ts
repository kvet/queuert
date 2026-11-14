import { syncStep as __syncStep } from "@queuert/sync-async";

export const countRows = {
  sync: function countRowsSync(db, keys) {
    const countOne = {
      sync: function countOneSync(key) {
        const rows = __syncStep(db.query(key));
        return rows.length;
      },
      async: async function countOneAsync(key) {
        const rows = await db.query(key);
        return rows.length;
      },
    };
    let total = 0;
    for (const key of keys) total += __syncStep(countOne.sync(key));
    return total;
  },
  async: async function countRowsAsync(db, keys) {
    const countOne = {
      sync: function countOneSync(key) {
        const rows = __syncStep(db.query(key));
        return rows.length;
      },
      async: async function countOneAsync(key) {
        const rows = await db.query(key);
        return rows.length;
      },
    };
    let total = 0;
    for (const key of keys) total += await countOne.async(key);
    return total;
  },
};
