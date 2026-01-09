import { extendWithRedis, TESTCONTAINER_RESOURCE_TYPES } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithResourceLeakDetection,
  extendWithStateInProcess,
  notifyResilienceTestSuite,
  notifyTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithRedisNotify } from "./notify-adapter.redis.spec-helper.js";

const inProcessInProcessIt = extendWithResourceLeakDetection(
  extendWithRedisNotify(
    extendWithRedis(extendWithCommon(extendWithStateInProcess(it)), import.meta.url),
  ),
  { additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES },
);

describe("Notify", () => {
  notifyTestSuite({ it: inProcessInProcessIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: inProcessInProcessIt });
});
