// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { createMysqlIsolationPool } from "./state-adapter-conformance.spec-helper.ts";
import { capabilityGroups, createEndToEndContext } from "./state-adapter-end-to-end.spec-helper.ts";

const { connectionOptions } = await acquireMysql("mariadb:11.4", import.meta.url);

const it = baseIt
  .extend("pool", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = await createMysqlIsolationPool(
      { ...connectionOptions, connectionLimit: 20 },
      "REPEATABLE READ",
    );
    onCleanup(async () => pool.end());
    return pool;
  })
  .extend("conformance", { scope: "file" }, async ({ pool }) =>
    createEndToEndContext(pool, "mariadb", "REPEATABLE READ", async () => noopNotifyAdapter),
  );

// NOTE: hack for vitest plugin
baseIt("index");

describe("mariadb:11.4 End-to-End Conformance, noop notify, REPEATABLE READ", () => {
  conformanceTestSuite({
    it,
    groups: [...endToEndBaseGroups, ...endToEndAsyncGroups, ...capabilityGroups],
  });
});
