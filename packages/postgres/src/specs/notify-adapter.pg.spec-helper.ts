import { Pool } from "pg";
import type { NotifyAdapter } from "queuert";
import { type TestAPI } from "vitest";
import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.js";
import { createPgPoolNotifyProvider } from "./notify-provider.pg-pool.js";

export const extendWithPostgresNotify = <
  T extends {
    postgresConnectionString: string;
  },
>(
  api: TestAPI<T>,
): TestAPI<T & { notifyAdapter: NotifyAdapter }> => {
  return api.extend<{
    notifyAdapter: NotifyAdapter;
  }>({
    notifyAdapter: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({ connectionString: postgresConnectionString });

        const provider = createPgPoolNotifyProvider({ pool });
        const notifyAdapter = await createPgNotifyAdapter({
          provider,
          channelPrefix: `queuert_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await pool.end();
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithPostgresNotify<T>>;
};
