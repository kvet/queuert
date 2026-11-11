// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe } from "vitest";

import {
  createPgStateProviderConformanceContext,
  pgStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import { withPgPoolNonTransactionContext } from "../state-provider/state-provider.pg-pool.spec-helper.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
  onCleanup(async () => pool.end());
  return createPgStateProviderConformanceContext({
    createStateProvider: async () => createPgPoolProvider({ pool }),
    withNonTransactionContext: withPgPoolNonTransactionContext(pool),
  });
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("PostgreSQL State Provider Conformance", () => {
  conformanceTestSuite({ it, groups: pgStateProviderConformanceGroups });
});
