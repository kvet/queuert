// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import { TESTCONTAINERS_RESOURCE_TYPES, acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { capabilityGroups, createEndToEndContext } from "./state-adapter-end-to-end.spec-helper.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const createIsolationLevelIt = (defaultTransactionIsolation: string) =>
  baseIt
    .extend("pool", { scope: "file" }, async ({}, { onCleanup }) => {
      const pool = new Pool({
        connectionString: pg.connectionString,
        idleTimeoutMillis: 0,
        max: 5,
        options: `-c default_transaction_isolation=${defaultTransactionIsolation}`,
      });
      onCleanup(async () => pool.end());
      return pool;
    })
    .extend(
      "resourceLeakCheck",
      { auto: true },
      detectResourceLeaks({ additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES }),
    )
    .extend("conformance", { scope: "file" }, async ({ pool }) =>
      createEndToEndContext(pool, async () => noopNotifyAdapter),
    );

const repeatableReadIt = createIsolationLevelIt("repeatable\\ read");
const serializableIt = createIsolationLevelIt("serializable");

// NOTE: hack for vitest plugin
baseIt("index");

describe("PostgreSQL End-to-End Conformance, noop notify, REPEATABLE READ", () => {
  conformanceTestSuite({
    it: repeatableReadIt,
    groups: [...endToEndBaseGroups, ...endToEndAsyncGroups, ...capabilityGroups],
  });
});

describe("PostgreSQL End-to-End Conformance, noop notify, SERIALIZABLE", () => {
  conformanceTestSuite({
    it: serializableIt,
    groups: [...endToEndBaseGroups, ...endToEndAsyncGroups, ...capabilityGroups],
  });
});
