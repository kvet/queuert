import type { Pool } from "pg";

import type { PgPoolContext } from "./state-provider.pg-pool.ts";

export const withPgPoolNonTransactionContext =
  (pool: Pool) =>
  async <T>(fn: (txCtx: PgPoolContext) => Promise<T>): Promise<T> => {
    const poolClient = await pool.connect();
    try {
      return await fn({ poolClient });
    } finally {
      poolClient.release();
    }
  };
