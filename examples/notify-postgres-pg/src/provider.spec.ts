import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createPgPoolNotifyProvider } from "./provider.js";

test("notify-postgres-pg provider passes notify adapter conformance", async () => {
  await runNotifyAdapterConformance(async () => {
    const container = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
    const pool = new Pool({ connectionString: container.getConnectionUri(), max: 10 });
    const provider = createPgPoolNotifyProvider({ pool });
    const notifyAdapter = await createPgNotifyAdapter({
      provider,
      channelPrefix: `qrt_spec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await provider.close();
        await pool.end();
        await container.stop();
      },
    };
  });
}, 60_000);
