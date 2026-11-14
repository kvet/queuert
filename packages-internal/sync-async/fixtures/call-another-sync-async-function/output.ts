import { syncStep as __syncStep } from "@queuert/sync-async";

const findRow = {
  sync: function findRowSync(db, key) {
    const [row] = __syncStep(db.query(key));
    return row;
  },
  async: async function findRowAsync(db, key) {
    const [row] = await db.query(key);
    return row;
  },
};

export const findRows = {
  sync: function findRowsSync(db, keys) {
    const rows = [];
    for (const key of keys) {
      rows.push(__syncStep(findRow.sync(db, key)));
    }
    return rows;
  },
  async: async function findRowsAsync(db, keys) {
    const rows = [];
    for (const key of keys) {
      rows.push(await findRow.async(db, key));
    }
    return rows;
  },
};
