import { syncStep as __syncStep } from "@queuert/sync-async";

export const createTables = {
  sync: function createTablesSync(db) {
    __syncStep(db.execute(`
CREATE TABLE job (
  id TEXT PRIMARY KEY
)`));
  },
  async: async function createTablesAsync(db) {
    await db.execute(`
CREATE TABLE job (
  id TEXT PRIMARY KEY
)`);
  },
};
