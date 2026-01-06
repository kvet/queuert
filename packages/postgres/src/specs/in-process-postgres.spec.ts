import { extendWithPostgres } from "@queuert/testcontainers";
import {
  extendWithCommon,
  extendWithStateInProcess,
  notifyResilienceTestSuite,
  notifyTestSuite,
} from "queuert/testing";
import { describe, it } from "vitest";
import { extendWithPostgresNotify } from "./notify-adapter.pg.spec-helper.js";

const inProcessPostgresIt = extendWithPostgresNotify(
  extendWithCommon(extendWithStateInProcess(extendWithPostgres(it, import.meta.url))),
);

describe("Notify", () => {
  notifyTestSuite({ it: inProcessPostgresIt });
});

describe("Notify Resilience", () => {
  notifyResilienceTestSuite({ it: inProcessPostgresIt });
});
