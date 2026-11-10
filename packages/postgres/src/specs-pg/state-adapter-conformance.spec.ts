import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe } from "vitest";

import {
  type PgStateProviderConformanceContext,
  createPgStateProviderConformanceContext,
  pgStateProviderConformanceCases,
} from "../conformance/state-provider-conformance.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";

const it = extendWithPostgres(baseIt, import.meta.url).extend<{
  conformance: PgStateProviderConformanceContext;
}>({
  conformance: [
    async ({ postgresConnectionString }, use) => {
      const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
      await use(
        await createPgStateProviderConformanceContext({
          createStateProvider: async () => createPgPoolProvider({ pool }),
          withNonTransactionContext: async (fn) => {
            const poolClient = await pool.connect();
            try {
              const pgCtx: PgPoolContext = { poolClient };
              return await fn(pgCtx);
            } finally {
              poolClient.release();
            }
          },
        }),
      );
      await pool.end();
    },
    { scope: "file" },
  ],
});

// NOTE: hack for vitest plugin
it("index");

describe("PostgreSQL State Provider Conformance", () => {
  for (const conformanceCase of pgStateProviderConformanceCases) {
    it(conformanceCase.title, async ({ conformance }) => {
      await conformanceCase.run(conformance);
    });
  }
});
