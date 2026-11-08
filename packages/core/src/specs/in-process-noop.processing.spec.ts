import { describe, it } from "vitest";

import { extendWithStateInProcess } from "../state-adapter/state-adapter.in-process.spec-helper.ts";
import { processErrorHandlingTestSuite } from "../suites/process-error-handling.test-suite.ts";
import { processTestSuite } from "../suites/process.test-suite.ts";
import {
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
} from "../suites/spec-context.spec-helper.ts";
import { workerTestSuite } from "../suites/worker.test-suite.ts";

const inProcessNoopIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(extendWithCommon(extendWithStateInProcess(it))),
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: inProcessNoopIt });
});

describe("Process", () => {
  processTestSuite({ it: inProcessNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: inProcessNoopIt });
});
