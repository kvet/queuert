import { type StateAdapter } from "queuert";
import {
  blockerSequencesTestSuite,
  extendWithCommon,
  extendWithStateInProcess,
  notifyTestSuite,
  processTestSuite,
  reaperTestSuite,
  sequencesTestSuite,
  waitSequenceCompletionTestSuite,
  workerlessCompletionTestSuite,
  workerTestSuite,
} from "queuert/testing";
import { extendWithRedis } from "@queuert/testcontainers";
import { describe, it, TestAPI } from "vitest";
import { extendWithRedisNotify } from "./notify-adapter.redis.spec-helper.js";

const inProcessInProcessIt = extendWithRedisNotify(
  extendWithRedis(
    extendWithCommon(
      extendWithStateInProcess(it) as unknown as TestAPI<{
        stateAdapter: StateAdapter<{ $test: true }, string>;
        flakyStateAdapter: StateAdapter<{ $test: true }, string>;
      }>,
    ),
    import.meta.url,
  ),
);

describe("Process", () => {
  processTestSuite({ it: inProcessInProcessIt });
});

describe("Worker", () => {
  workerTestSuite({ it: inProcessInProcessIt });
});

describe("Reaper", () => {
  reaperTestSuite({ it: inProcessInProcessIt });
});

describe("Sequences", () => {
  sequencesTestSuite({ it: inProcessInProcessIt });
});

describe("Blocker Sequences", () => {
  blockerSequencesTestSuite({ it: inProcessInProcessIt });
});

describe("Wait Sequence Completion", () => {
  waitSequenceCompletionTestSuite({ it: inProcessInProcessIt });
});

describe("Notify", () => {
  notifyTestSuite({ it: inProcessInProcessIt });
});

describe("Workerless Completion", () => {
  workerlessCompletionTestSuite({ it: inProcessInProcessIt });
});
