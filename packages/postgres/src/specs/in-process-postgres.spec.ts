import { TESTCONTAINER_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithResourceLeakDetection,
  extendWithStateInProcess,
  notifyResilienceTestSuite,
  notifyTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithNotifyPostgres } from "./notify-adapter.pg.spec-helper.js";

const inProcessPostgresIt = extendWithResourceLeakDetection(
  extendWithNotifyPostgres(
    extendWithCommon(extendWithStateInProcess(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Notify", () => {
  notifyTestSuite({ it: inProcessPostgresIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: inProcessPostgresIt });
});
