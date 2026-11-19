// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import { TESTCONTAINERS_RESOURCE_TYPES, acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { endToEndAsyncGroups, endToEndBaseGroups } from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { capabilityGroups, createEndToEndContext } from "./state-adapter-end-to-end.spec-helper.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const it = baseIt
  .extend("pool", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = new Pool({
      connectionString: pg.connectionString,
      idleTimeoutMillis: 0,
      pipeline: true,
    });
    onCleanup(async () => pool.end());
    return pool;
  })
  .extend(
    "resourceLeakCheck",
    { auto: true },
    detectResourceLeaks({ additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES }),
  )
  .extend("conformance", { scope: "file" }, async ({ pool }) => createEndToEndContext(pool));

// NOTE: hack for vitest plugin
baseIt("index");

describe("PostgreSQL End-to-End Conformance, pipelined pool, in-process notify", () => {
  conformanceTestSuite({
    it,
    groups: [...endToEndBaseGroups, ...endToEndAsyncGroups, ...capabilityGroups],
  });
});
