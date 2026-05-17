import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithResourceLeakDetection,
  extendWithStateInProcess,
  notifyResilienceTestSuite,
  notifyTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";

import { extendWithNotifyPg } from "./notify-adapter.pg.spec-helper.js";

const inProcessPostgresIt = extendWithResourceLeakDetection(
  extendWithNotifyPg(
    extendWithCommon(extendWithStateInProcess(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Notify", () => {
  notifyTestSuite({ it: inProcessPostgresIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: inProcessPostgresIt });
});
