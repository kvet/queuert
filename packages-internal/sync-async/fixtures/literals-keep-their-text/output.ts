import { syncStep as __syncStep } from "@queuert/sync-async";

export const createTables = {
  sync: function (
    db,
    prefix = `
job_`,
  ) {
    const sql = "CREATE TABLE \
job (id TEXT PRIMARY KEY)";
    __syncStep(db.execute(prefix + sql));
  },
  async: async function (
    db,
    prefix = `
job_`,
  ) {
    const sql = "CREATE TABLE \
job (id TEXT PRIMARY KEY)";
    await db.execute(prefix + sql);
  },
};
