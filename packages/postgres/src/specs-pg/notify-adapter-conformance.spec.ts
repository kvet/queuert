import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import type { NotifyConformanceFixture } from "queuert/conformance";
import { notifyAdapterBaseGroups } from "queuert/conformance-internal";
import { type ConformanceFixtures, conformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe } from "vitest";

import {
  createPgNotifyConformanceContext,
  pgNotifyProviderConformanceGroups,
} from "../conformance/notify-provider-conformance.ts";
import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.ts";
import { createPgPoolNotifyProvider } from "../notify-provider/notify-provider.pg-pool.ts";

const it = extendWithPostgres(baseIt, import.meta.url);

const providerIt = it.extend<ConformanceFixtures<NotifyConformanceFixture>>({
  conformance: [
    async ({ postgresConnectionString }, use) => {
      const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
      const notifyProvider = createPgPoolNotifyProvider({ pool });
      await use(createPgNotifyConformanceContext({ notifyProvider }));
      await notifyProvider.close?.();
      await pool.end();
    },
    { scope: "file" },
  ],
});

const customPrefixIt = it.extend<ConformanceFixtures<NotifyConformanceFixture>>({
  conformance: [
    async ({ postgresConnectionString }, use) => {
      const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
      const notifyProvider = createPgPoolNotifyProvider({ pool });
      await use({
        notifyAdapter: createPgNotifyAdapter({
          notifyProvider,
          channelPrefix: "myapp_notifications",
        }),
      });
      await notifyProvider.close?.();
      await pool.end();
    },
    { scope: "file" },
  ],
});

// NOTE: hack for vitest plugin
it("index");

describe("PostgreSQL Notify Provider Conformance", () => {
  conformanceTestSuite({ it: providerIt, groups: pgNotifyProviderConformanceGroups });
});

describe("PostgreSQL Notify Adapter Conformance - Custom Channel Prefix", () => {
  conformanceTestSuite({ it: customPrefixIt, groups: notifyAdapterBaseGroups });
});
