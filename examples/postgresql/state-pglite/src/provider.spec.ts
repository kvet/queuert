import { PGlite } from "@electric-sql/pglite";
import {
  createPgMigratorConformanceCases,
  createPgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPgliteStateProvider } from "./provider.ts";

// #region conformance
describe("postgresql/state-pglite provider conformance", () => {
  let pglite: PGlite;
  const cases = createPgStateProviderConformanceCases({
    createStateProvider: async () => createPgliteStateProvider({ pglite }),
    withNonTransactionContext: async (fn) => fn({ pglite }),
    singleConnection: true,
  });

  beforeAll(async () => {
    pglite = await PGlite.create();
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("postgresql/state-pglite migrator conformance", () => {
  let pglite: PGlite;
  const cases = createPgMigratorConformanceCases({
    createStateProvider: () => createPgliteStateProvider({ pglite }),
  });

  beforeAll(async () => {
    pglite = await PGlite.create();
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
