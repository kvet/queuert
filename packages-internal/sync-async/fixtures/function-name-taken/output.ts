import { syncStep as __syncStep } from "@queuert/sync-async";

const findRowSync = (db, key) => db.query(key);

export const findRow = {
  sync: function (db, key) {
    return __syncStep(findRowSync(db, key));
  },
  async: async function (db, key) {
    return await findRowSync(db, key);
  },
};
