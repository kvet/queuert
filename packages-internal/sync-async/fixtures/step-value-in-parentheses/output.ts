import { syncStep as __syncStep } from "@queuert/sync-async";

export const readCached = {
  sync: function (db, key) {
    const rows = __syncStep(cache.get(key) ?? db.query(key));
    return (__syncStep(db.count(key))) + rows.length;
  },
  async: async function (db, key) {
    const rows = await (cache.get(key) ?? db.query(key));
    return (await db.count(key)) + rows.length;
  },
};
