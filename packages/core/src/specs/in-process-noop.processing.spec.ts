import { describe, it } from "vitest";
import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.js";
import { processErrorHandlingTestSuite } from "../suites/process-error-handling.test-suite.js";
import { processModesTestSuite } from "../suites/process-modes.test-suite.js";
import { processTestSuite } from "../suites/process.test-suite.js";
import { reaperTestSuite } from "../suites/reaper.test-suite.js";
import {
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
} from "../suites/spec-context.spec-helper.js";
import { workerTestSuite } from "../suites/worker.test-suite.js";

const inProcessNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(extendWithCommon(extendWithStateInProcess(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: inProcessNoopIt });
});

describe("Process Modes", () => {
  processModesTestSuite({ it: inProcessNoopIt });
});

describe("Process", () => {
  processTestSuite({ it: inProcessNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: inProcessNoopIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: inProcessNoopIt });
});
