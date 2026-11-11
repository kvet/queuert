// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import { TESTCONTAINERS_RESOURCE_TYPES, acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import {
  type ConformanceGroup,
  type EndToEndFlakyDbContext,
  type EndToEndPoisonTransactionContext,
  type EndToEndSavepointContext,
  endToEndBaseGroups,
  endToEndConcurrentTransactionGroups,
  endToEndFlakyDbConcurrentTransactionGroups,
  endToEndFlakyDbGroups,
  endToEndNotifyGroups,
  endToEndPoisonTransactionGroups,
  endToEndSavepointGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { createPgNotifyProviderConformanceContext } from "../conformance/notify-provider-conformance.ts";
import { createPgPoolNotifyProvider } from "../notify-provider/notify-provider.pg-pool.ts";
import { createPgEndToEndContext } from "./end-to-end-context.spec-helper.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const it = baseIt
  .extend("pool", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    onCleanup(async () => pool.end());
    return pool;
  })
  .extend(
    "resourceLeakCheck",
    { auto: true },
    detectResourceLeaks({ additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES }),
  );

const noopNotifyIt = it.extend("conformance", { scope: "file" }, async ({ pool }) =>
  createPgEndToEndContext({ pool, createNotifyAdapter: async () => noopNotifyAdapter }),
);

const inProcessNotifyIt = it.extend("conformance", { scope: "file" }, async ({ pool }) =>
  createPgEndToEndContext({ pool }),
);

const pgNotifyIt = it
  .extend("notifyPool", { scope: "file" }, async ({}, { onCleanup }) => {
    const notifyPool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    onCleanup(async () => notifyPool.end());
    return notifyPool;
  })
  .extend("conformance", { scope: "file" }, async ({ pool, notifyPool }) =>
    createPgEndToEndContext({
      pool,
      createNotifyAdapter: createPgNotifyProviderConformanceContext({
        createNotifyProvider: async () => createPgPoolNotifyProvider({ pool: notifyPool }),
      }).createNotifyAdapter,
    }),
  );

const capabilityGroups: ConformanceGroup<
  EndToEndSavepointContext & EndToEndPoisonTransactionContext & EndToEndFlakyDbContext
>[] = [
  ...endToEndConcurrentTransactionGroups,
  ...endToEndSavepointGroups,
  ...endToEndPoisonTransactionGroups,
  ...endToEndFlakyDbGroups,
  ...endToEndFlakyDbConcurrentTransactionGroups,
];

// NOTE: hack for vitest plugin
baseIt("index");

describe("PostgreSQL End-to-End Conformance, noop notify", () => {
  conformanceTestSuite({ it: noopNotifyIt, groups: [...endToEndBaseGroups, ...capabilityGroups] });
});

describe("PostgreSQL End-to-End Conformance, in-process notify", () => {
  conformanceTestSuite({ it: inProcessNotifyIt, groups: capabilityGroups });
});

describe("PostgreSQL End-to-End Conformance, PostgreSQL notify", () => {
  conformanceTestSuite({
    it: pgNotifyIt,
    groups: [...endToEndBaseGroups, ...endToEndNotifyGroups, ...capabilityGroups],
  });
});
