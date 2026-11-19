import type { Pool } from "mysql2/promise";

import { createProviderEndToEndContext } from "../specs/state-adapter-end-to-end.spec-helper.ts";
import {
  withMysql2PoolNonTransactionContext,
  withMysql2PoolSavepoint,
} from "../state-provider/state-provider.mysql2-pool.spec-helper.ts";
import { createMysql2PoolProvider } from "../state-provider/state-provider.mysql2-pool.ts";

export const createEndToEndContext = async (
  pool: Pool,
  dialect: "mysql" | "mariadb",
  createNotifyAdapter: Parameters<typeof createProviderEndToEndContext>[0]["createNotifyAdapter"],
): ReturnType<typeof createProviderEndToEndContext> =>
  createProviderEndToEndContext({
    createStateProvider: () => createMysql2PoolProvider({ pool }),
    dialect,
    withNonTransactionContext: withMysql2PoolNonTransactionContext(pool),
    withSavepoint: withMysql2PoolSavepoint,
    createNotifyAdapter,
  });
