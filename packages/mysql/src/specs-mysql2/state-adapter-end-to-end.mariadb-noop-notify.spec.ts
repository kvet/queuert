// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import {
  capabilityGroups,
  createEndToEndContext,
  noRetryGroups,
} from "./state-adapter-end-to-end.spec-helper.ts";

const { connectionOptions } = await acquireMysql("mariadb:11.4", import.meta.url);

const it = baseIt
  .extend("pool", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({ ...connectionOptions, connectionLimit: 20 });
    onCleanup(async () => pool.end());
    return pool;
  })
  .extend("conformance", { scope: "file" }, async ({ pool }) =>
    createEndToEndContext(pool, "mariadb", async () => noopNotifyAdapter),
  );

const noRetryIt = it.extend("conformance", { scope: "file" }, async ({ pool }) =>
  createEndToEndContext(pool, "mariadb", async () => noopNotifyAdapter, {
    transactionRetry: { maxTries: 1, initialDelayMs: 0, maxDelayMs: 0 },
  }),
);

// NOTE: hack for vitest plugin
baseIt("index");

describe("mariadb:11.4 End-to-End Conformance, noop notify", () => {
  conformanceTestSuite({
    it,
    groups: [...endToEndBaseGroups, ...endToEndAsyncGroups, ...capabilityGroups],
  });
});

describe("mariadb:11.4 End-to-End Conformance, noop notify, without transaction retries", () => {
  conformanceTestSuite({ it: noRetryIt, groups: noRetryGroups });
});
