// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  endToEndNotifyConcurrentTransactionGroups,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { capabilityGroups, createEndToEndContext } from "./state-adapter-end-to-end.spec-helper.ts";

const { connectionOptions } = await acquireMysql("mariadb:11.4", import.meta.url);

const it = baseIt
  .extend("pool", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({ ...connectionOptions, connectionLimit: 20 });
    onCleanup(async () => pool.end());
    return pool;
  })
  .extend("conformance", { scope: "file" }, async ({ pool }) =>
    createEndToEndContext(pool, "mariadb", undefined),
  );

// NOTE: hack for vitest plugin
baseIt("index");

describe("mariadb:11.4 End-to-End Conformance, in-process notify", () => {
  conformanceTestSuite({
    it,
    groups: [
      ...endToEndBaseGroups,
      ...endToEndAsyncGroups,
      ...capabilityGroups,
      ...endToEndNotifyConcurrentTransactionGroups,
    ],
  });
});
