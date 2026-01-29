import { TESTCONTAINER_RESOURCE_TYPES, extendWithRedis } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithResourceLeakDetection,
  extendWithStateInProcess,
  notifyResilienceTestSuite,
  notifyTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithNotifyRedis } from "./notify-adapter.redis.spec-helper.js";

const inProcessInProcessIt = extendWithResourceLeakDetection(
  extendWithNotifyRedis(
    extendWithRedis(extendWithCommon(extendWithStateInProcess(it)), import.meta.url),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

// NOTE: hack for vitest plugin
it("index");

describe("Notify", () => {
  notifyTestSuite({ it: inProcessInProcessIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: inProcessInProcessIt });
});
