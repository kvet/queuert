import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithResourceLeakDetection,
  processErrorHandlingTestSuite,
  processTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";

import { extendWithStatePg } from "./state-adapter.pg.spec-helper.ts";

const postgresNoopIt = extendWithResourceLeakDetection(
  extendWithCommon(extendWithStatePg(extendWithPostgres(it, import.meta.url))),
  { additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: postgresNoopIt });
});

describe("Process", () => {
  processTestSuite({ it: postgresNoopIt });
});

describe("Worker", () => {
  workerTestSuite({ it: postgresNoopIt });
});
