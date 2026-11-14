// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import Database from "better-sqlite3";
import {
  endToEndFlakyDbGroups,
  endToEndNotifyGroups,
  endToEndSavepointGroups,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { createEndToEndContext } from "./state-adapter-end-to-end.spec-helper.ts";

const it = baseIt
  .extend("resourceLeakCheck", { auto: true }, detectResourceLeaks())
  .extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const db = new Database(":memory:");
    onCleanup(async () => {
      db.close();
    });
    return createEndToEndContext(db, "async");
  });

// NOTE: hack for vitest plugin
baseIt("index");

describe("SQLite End-to-End Conformance, in-process notify", () => {
  conformanceTestSuite({
    it,
    groups: [...endToEndNotifyGroups, ...endToEndSavepointGroups, ...endToEndFlakyDbGroups],
  });
});
