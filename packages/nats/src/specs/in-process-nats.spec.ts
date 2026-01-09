import { extendWithNats } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithStateInProcess,
  notifyResilienceTestSuite,
  notifyTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithNatsNotify } from "./notify-adapter.nats.spec-helper.js";

const inProcessNatsIt = extendWithNatsNotify(
  extendWithNats(extendWithCommon(extendWithStateInProcess(it)), import.meta.url),
);

describe("Notify", () => {
  notifyTestSuite({ it: inProcessNatsIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: inProcessNatsIt });
});
