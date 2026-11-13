// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import Database from "better-sqlite3";
import type { AdapterMode } from "queuert";
import {
  endToEndBaseGroups,
  endToEndFlakyDbGroups,
  endToEndNotifyGroups,
  endToEndSavepointGroups,
  noopNotifyAdapter,
  syncNoopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { createSqliteEndToEndContext } from "./end-to-end-context.spec-helper.ts";

const it = baseIt.extend("resourceLeakCheck", { auto: true }, detectResourceLeaks());

const noopNotifyIt = (mode: AdapterMode) =>
  it.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const db = new Database(":memory:");
    onCleanup(async () => {
      db.close();
    });
    return createSqliteEndToEndContext({
      db,
      mode,
      createNotifyAdapter: () => (mode === "sync" ? syncNoopNotifyAdapter : noopNotifyAdapter),
    });
  });

const inProcessNotifyIt = (mode: AdapterMode) =>
  it.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const db = new Database(":memory:");
    onCleanup(async () => {
      db.close();
    });
    return createSqliteEndToEndContext({ db, mode });
  });

// NOTE: hack for vitest plugin
baseIt("index");

for (const mode of ["async", "sync"] as const) {
  const label = mode === "sync" ? "Sync SQLite" : "SQLite";
  const noopIt = noopNotifyIt(mode);
  const inProcessIt = inProcessNotifyIt(mode);

  describe(`${label} End-to-End Conformance, noop notify`, () => {
    conformanceTestSuite({
      it: noopIt,
      groups: [...endToEndBaseGroups, ...endToEndSavepointGroups, ...endToEndFlakyDbGroups],
      mode,
    });
  });

  describe(`${label} End-to-End Conformance, in-process notify`, () => {
    conformanceTestSuite({
      it: inProcessIt,
      groups: [...endToEndNotifyGroups, ...endToEndSavepointGroups, ...endToEndFlakyDbGroups],
      mode,
    });
  });
}
