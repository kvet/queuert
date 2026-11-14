import { syncStep as __syncStep } from "@queuert/sync-async";

export const insertAll = {
  sync: function (db, items) {
    const rows = function* () {
      for (const item of items) yield [item.id, item.name];
    };
    __syncStep(db.insertMany(rows()));
  },
  async: async function (db, items) {
    const rows = function* () {
      for (const item of items) yield [item.id, item.name];
    };
    await db.insertMany(rows());
  },
};
