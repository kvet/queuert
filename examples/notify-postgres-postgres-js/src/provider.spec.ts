import { createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createPostgresJsNotifyProvider } from "./provider.js";

test("notify-postgres-postgres-js provider passes notify adapter conformance", async () => {
  await runNotifyAdapterConformance(async () => {
    const container = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
    const sql = postgres(container.getConnectionUri(), { max: 10 });
    const provider = createPostgresJsNotifyProvider({ sql });
    const notifyAdapter = await createPgNotifyAdapter({
      provider,
      channelPrefix: `qrt_spec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await sql.end();
        await container.stop();
      },
    };
  });
}, 60_000);
