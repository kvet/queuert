import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import {
  createSeedStateAdapter,
  generateStateDump,
  readStateCounts,
  readStateRows,
  shiftStateDump,
  toStateRows,
} from "queuert/conformance-internal";
import { expect, it } from "vitest";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import {
  type Mysql2PoolContext,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";
import { loadStateDump } from "./load-state-dump.ts";

it.for([
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
])(
  "loads a dump that the $image adapter reads back shifted by the offset",
  { timeout: 120_000 },
  async ({ image, dialect }) => {
    const { connectionOptions } = await acquireMysql(image, `${import.meta.url}-${dialect}`);
    const pool = createPool({ ...connectionOptions, connectionLimit: 10 });
    const stateProvider = createMysql2PoolProvider({ pool });
    const stateAdapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
      stateProvider,
      dialect,
    });
    await stateAdapter.migrateToLatest();
    const { dump } = generateStateDump();
    const offsetMs = Date.now() - dump.capturedAt.getTime();
    const reference = createSeedStateAdapter();
    reference.loadState(dump, { offsetMs });

    await loadStateDump(stateProvider, dump, { offsetMs });

    expect(await readStateRows(stateAdapter)).toEqual(toStateRows(shiftStateDump(dump, offsetMs)));

    expect(await readStateCounts(stateAdapter)).toEqual(readStateCounts(reference.stateAdapter));
    await pool.end();
  },
);
