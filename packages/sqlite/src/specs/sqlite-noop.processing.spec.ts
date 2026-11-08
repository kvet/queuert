import {
  extendWithCommon,
  extendWithResourceLeakDetection,
  processErrorHandlingTestSuite,
  processTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";

import { extendWithStateSqlite } from "./state-adapter.sqlite.spec-helper.ts";

const sqliteNoopIt = extendWithResourceLeakDetection(extendWithCommon(extendWithStateSqlite(it)));

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: sqliteNoopIt });
});

describe("Process", () => {
  processTestSuite({ it: sqliteNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: sqliteNoopIt });
});
