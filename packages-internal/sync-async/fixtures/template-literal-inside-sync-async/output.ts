import { syncStep as __syncStep } from "@queuert/sync-async";

export const createTables = {
  sync: function (db) {
    __syncStep(db.execute(`
CREATE TABLE job (
  id TEXT PRIMARY KEY
)`));
  },
  async: async function (db) {
    await db.execute(`
CREATE TABLE job (
  id TEXT PRIMARY KEY
)`);
  },
};
