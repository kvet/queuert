import { detectResourceLeaks } from "@queuert/helpers/testing";
import { TESTCONTAINERS_RESOURCE_TYPES, acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import {
  createSeedStateAdapter,
  generateStateDump,
  readStateCounts,
  readStateRows,
  shiftStateDump,
  toStateRows,
} from "queuert/conformance-internal";
import { it as baseIt, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";
import { loadStateDump } from "./load-state-dump.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const it = baseIt.extend(
  "resourceLeakCheck",
  { auto: true },
  detectResourceLeaks({ additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES }),
);

it(
  "loads a dump that the adapter reads back shifted by the offset",
  { timeout: 60_000 },
  async () => {
    const pool = new Pool({ connectionString: pg.connectionString });
    const stateProvider = createPgPoolProvider({ pool });
    const stateAdapter = createPgStateAdapter<PgPoolContext, string>({ stateProvider });
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
