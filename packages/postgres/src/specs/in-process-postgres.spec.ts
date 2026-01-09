import { extendWithPostgres, TESTCONTAINER_RESOURCE_TYPES } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithResourceLeakDetection,
  extendWithStateInProcess,
  notifyResilienceTestSuite,
  notifyTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithPostgresNotify } from "./notify-adapter.pg.spec-helper.js";

const inProcessPostgresIt = extendWithResourceLeakDetection(
  extendWithPostgresNotify(
    extendWithCommon(extendWithStateInProcess(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

describe("Notify", () => {
  notifyTestSuite({ it: inProcessPostgresIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: inProcessPostgresIt });
});
