import {
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
  processErrorHandlingTestSuite,
  processModesTestSuite,
  processTestSuite,
  reaperTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithStateSqlite } from "./state-adapter.sqlite.spec-helper.js";

const sqliteNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(extendWithCommon(extendWithStateSqlite(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: sqliteNoopIt });
});

describe("Process Modes", () => {
  processModesTestSuite({ it: sqliteNoopIt });
});

describe("Process", () => {
  processTestSuite({ it: sqliteNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: sqliteNoopIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: sqliteNoopIt });
});
