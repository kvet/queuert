import {
  extendWithCommon,
  extendWithNotifyInProcess,
  extendWithResourceLeakDetection,
  processErrorHandlingTestSuite,
  finishTestSuite,
  processTestSuite,
  attemptReclaimerTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";

import { extendWithStateSqlite } from "./state-adapter.sqlite.spec-helper.js";

const sqliteInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyInProcess(extendWithCommon(extendWithStateSqlite(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: sqliteInProcessIt });
});

describe("Finish", () => {
  finishTestSuite({ it: sqliteInProcessIt });
});

describe("Process", () => {
  processTestSuite({ it: sqliteInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: sqliteInProcessIt });
});

describe("Attempt Reclamation", () => {
  attemptReclaimerTestSuite({ it: sqliteInProcessIt });
});
