import { createPgNotifyAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createPgPoolNotifyProvider } from "./provider.js";

test("notify-postgres-pg provider passes notify adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runNotifyAdapterConformance(async () => {
    const pool = new Pool({ connectionString: pg.connectionString, max: 10 });
    const notifyProvider = createPgPoolNotifyProvider({ pool });
    const notifyAdapter = await createPgNotifyAdapter({
      notifyProvider,
      channelPrefix: `qrt_spec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await notifyAdapter.close();
        await pool.end();
      },
    };
  });
}, 60_000);
