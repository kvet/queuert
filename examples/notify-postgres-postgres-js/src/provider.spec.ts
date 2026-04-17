import { createPgNotifyAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createPostgresJsNotifyProvider } from "./provider.js";

test("notify-postgres-postgres-js provider passes notify adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runNotifyAdapterConformance(async () => {
    const sql = postgres(pg.connectionString, { max: 10 });
    const notifyProvider = createPostgresJsNotifyProvider({ sql });
    const notifyAdapter = await createPgNotifyAdapter({
      notifyProvider,
      channelPrefix: `qrt_spec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await sql.end();
      },
    };
  });
}, 60_000);
