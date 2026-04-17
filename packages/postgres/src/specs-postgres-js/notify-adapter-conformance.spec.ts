import { extendWithPostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceTestSuite,
} from "queuert/testing";
import { it as baseIt, describe } from "vitest";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.js";
import { createPostgresJsNotifyProvider } from "../notify-provider/notify-provider.postgres-js.js";

const it = extendWithPostgres(baseIt, import.meta.url);

// NOTE: hack for vitest plugin
it("index");

describe("PostgreSQL Notify Adapter Conformance (postgres.js) - Default Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ postgresConnectionString }, use) => {
        const sql = postgres(postgresConnectionString, { max: 10, onnotice: () => {} });

        const provider = createPostgresJsNotifyProvider({ sql });
        const notifyAdapter = await createPgNotifyAdapter({ provider });

        await use(notifyAdapter);

        await sql.end();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("PostgreSQL Notify Adapter Conformance (postgres.js) - Custom Channel Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ postgresConnectionString }, use) => {
        const sql = postgres(postgresConnectionString, { max: 10, onnotice: () => {} });

        const provider = createPostgresJsNotifyProvider({ sql });
        const notifyAdapter = await createPgNotifyAdapter({
          provider,
          channelPrefix: "myapp_notifications",
        });

        await use(notifyAdapter);

        await sql.end();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});
