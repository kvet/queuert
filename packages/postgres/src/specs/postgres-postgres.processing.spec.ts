import { TESTCONTAINER_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithResourceLeakDetection,
  processErrorHandlingTestSuite,
  processModesTestSuite,
  processTestSuite,
  reaperTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithNotifyPostgres } from "./notify-adapter.pg.spec-helper.js";
import { extendWithStatePostgres } from "./state-adapter.pg.spec-helper.js";

const postgresPostgresIt = extendWithResourceLeakDetection(
  extendWithNotifyPostgres(
    extendWithCommon(extendWithStatePostgres(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Process Error Handling", () => {
  processErrorHandlingTestSuite({ it: postgresPostgresIt });
});

describe("Process Modes", () => {
  processModesTestSuite({ it: postgresPostgresIt });
});

describe("Process", () => {
  processTestSuite({ it: postgresPostgresIt });
});

describe("Worker", () => {
  workerTestSuite({ it: postgresPostgresIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: postgresPostgresIt });
});
