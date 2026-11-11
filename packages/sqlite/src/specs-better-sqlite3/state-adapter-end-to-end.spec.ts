// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import Database from "better-sqlite3";
import {
  endToEndBaseGroups,
  endToEndFlakyDbGroups,
  endToEndNotifyGroups,
  endToEndSavepointGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { createSqliteEndToEndContext } from "./end-to-end-context.spec-helper.ts";

const it = baseIt.extend("resourceLeakCheck", { auto: true }, detectResourceLeaks());

const noopNotifyIt = it.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const db = new Database(":memory:");
  onCleanup(async () => {
    db.close();
  });
  return createSqliteEndToEndContext({ db, createNotifyAdapter: async () => noopNotifyAdapter });
});

const inProcessNotifyIt = it.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const db = new Database(":memory:");
  onCleanup(async () => {
    db.close();
  });
  return createSqliteEndToEndContext({ db });
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("SQLite End-to-End Conformance, noop notify", () => {
  conformanceTestSuite({
    it: noopNotifyIt,
    groups: [...endToEndBaseGroups, ...endToEndSavepointGroups, ...endToEndFlakyDbGroups],
  });
});

describe("SQLite End-to-End Conformance, in-process notify", () => {
  conformanceTestSuite({
    it: inProcessNotifyIt,
    groups: [...endToEndNotifyGroups, ...endToEndSavepointGroups, ...endToEndFlakyDbGroups],
  });
});
