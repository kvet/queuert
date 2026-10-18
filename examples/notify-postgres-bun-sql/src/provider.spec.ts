import { test } from "bun:test";

import { createPgNotifyAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { SQL } from "bun";
import { runNotifyAdapterConformance } from "queuert/conformance";

import { createBunSqlNotifyProvider } from "./provider.js";

test("notify-postgres-bun-sql provider passes notify adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runNotifyAdapterConformance(async () => {
    const sql = new SQL(pg.connectionString, { max: 10 });

    const notifyProvider = createBunSqlNotifyProvider({ sql });
    const notifyAdapter = await createPgNotifyAdapter({
      notifyProvider,
      channelPrefix: `queuert_spec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await sql.close();
      },
    };
  });
}, 120_000);
