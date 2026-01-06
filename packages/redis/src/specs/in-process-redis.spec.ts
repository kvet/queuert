import { extendWithRedis } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithStateInProcess,
  notifyResilienceTestSuite,
  notifyTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithRedisNotify } from "./notify-adapter.redis.spec-helper.js";

const inProcessInProcessIt = extendWithRedisNotify(
  extendWithRedis(extendWithCommon(extendWithStateInProcess(it)), import.meta.url),
);

describe("Notify", () => {
  notifyTestSuite({ it: inProcessInProcessIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: inProcessInProcessIt });
});
