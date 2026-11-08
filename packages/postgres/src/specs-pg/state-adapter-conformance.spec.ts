import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import type { StateConformanceFixture } from "queuert/conformance";
import { type ConformanceFixtures, conformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe } from "vitest";

import {
  createPgConformanceContext,
  pgStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";

const it = extendWithPostgres(baseIt, import.meta.url).extend<
  ConformanceFixtures<StateConformanceFixture>
>({
  conformance: [
    async ({ postgresConnectionString }, use) => {
      const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
      await use(
        await createPgConformanceContext({
          stateProvider: createPgPoolProvider({ pool }),
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
  conformanceTestSuite({ it, groups: pgStateProviderConformanceGroups });
});
