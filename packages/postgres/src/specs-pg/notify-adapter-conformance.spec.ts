import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { type NotifyConformanceFixture, notifyAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe } from "vitest";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.js";
import { createPgPoolNotifyProvider } from "../notify-provider/notify-provider.pg-pool.js";

const it = extendWithPostgres(baseIt, import.meta.url);

// NOTE: hack for vitest plugin
it("index");

describe("PostgreSQL Notify Adapter Conformance - Default Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyConformanceFixture>({
    notifyAdapter: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({
          connectionString: postgresConnectionString,
          idleTimeoutMillis: 0,
        });

        const notifyProvider = createPgPoolNotifyProvider({ pool });
        const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

        await use(notifyAdapter);

        await notifyProvider.close?.();
        await pool.end();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("PostgreSQL Notify Adapter Conformance - Custom Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyConformanceFixture>({
    notifyAdapter: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({
          connectionString: postgresConnectionString,
          idleTimeoutMillis: 0,
        });

        const notifyProvider = createPgPoolNotifyProvider({ pool });
        const notifyAdapter = await createPgNotifyAdapter({
          notifyProvider,
          channelPrefix: "myapp_notifications",
        });

        await use(notifyAdapter);

        await notifyProvider.close?.();
        await pool.end();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});
