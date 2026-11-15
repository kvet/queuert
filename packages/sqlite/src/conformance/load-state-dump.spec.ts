import Database from "better-sqlite3";
import {
  createSeedStateAdapter,
  generateStateDump,
  readStateCounts,
  readStateRows,
  shiftStateDump,
  toStateRows,
} from "queuert/conformance-internal";
import { expect, it } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";
import { loadStateDump } from "./load-state-dump.ts";

it.for(["async", "sync"] as const)(
  "loads a dump that the adapter reads back shifted by the offset over a %s provider",
  async (mode) => {
    const db = new Database(":memory:");
    const stateProvider = createBetterSqlite3Provider({ db, mode });
    const stateAdapter = createSqliteStateAdapter<typeof stateProvider, string>({ stateProvider });
    await stateAdapter.migrateToLatest();
    const { dump } = generateStateDump();
    const offsetMs = Date.now() - dump.capturedAt.getTime();
    const reference = createSeedStateAdapter();
    reference.loadState(dump, { offsetMs });

    await loadStateDump(stateProvider, dump, { offsetMs });

    expect(await readStateRows(stateAdapter)).toEqual(toStateRows(shiftStateDump(dump, offsetMs)));

    expect(await readStateCounts(stateAdapter)).toEqual(readStateCounts(reference.stateAdapter));
  },
);
