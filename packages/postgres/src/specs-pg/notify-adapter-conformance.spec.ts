// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import { TESTCONTAINERS_RESOURCE_TYPES, acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { notifyAdapterEndToEndGroups } from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import {
  createPgNotifyProviderConformanceContext,
  pgNotifyProviderConformanceGroups,
} from "../conformance/notify-provider-conformance.ts";
import { createPgPoolNotifyProvider } from "../notify-provider/notify-provider.pg-pool.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const it = baseIt
  .extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    onCleanup(async () => pool.end());
    return createPgNotifyProviderConformanceContext({
      createNotifyProvider: async () => createPgPoolNotifyProvider({ pool }),
    });
  })
  .extend(
    "resourceLeakCheck",
    { auto: true },
    detectResourceLeaks({ additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES }),
  );

// NOTE: hack for vitest plugin
baseIt("index");

describe("PostgreSQL Notify Provider Conformance", () => {
  conformanceTestSuite({
    it,
    groups: [...pgNotifyProviderConformanceGroups, ...notifyAdapterEndToEndGroups],
  });
});
