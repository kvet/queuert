import { PGlite } from "@electric-sql/pglite";
import {
  createPgMigratorConformanceCases,
  createPgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createPgliteStateProvider } from "./provider.ts";

// #region conformance
const singleConnectionSkips = new Set([
  "addJobsBlockers > reports a blocker chain completed after the transaction's first read as complete",
  "unblockJobs > concurrent blocker chain completions unblock all jobs sharing those blockers",
  "startJobAttempts > acquires a due job while only its chain head is locked",
  "startJobAttempts > skips a due job whose row is locked and getStartAttemptDelayMs ignores it",
  "classifyError > classifies a serialization failure as transaction_conflict",
  "classifyError > classifies a deadlock as transaction_conflict",
  "startJobAttempts > a claim in an open transaction leaves the other due jobs to a concurrent claim",
  "startJobAttempts > a producer does not wait on an open claim that drained the queue",
  "schemaFence > fails a write with SchemaFencedError when its writes are fenced after the transaction began",
  "schemaFence > commits a transaction that already wrote before its writes are fenced",
]);

describe("postgresql/state-pglite provider conformance", () => {
  let pglite: PGlite;
  const cases = createPgStateProviderConformanceCases({
    createStateProvider: async () => createPgliteStateProvider({ pglite }),
    withNonTransactionContext: async (fn) => fn({ pglite }),
  });

  beforeAll(async () => {
    pglite = await PGlite.create();
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  // #hide
  test("every skipped title names a conformance case", () => {
    const titles = new Set(cases.map(({ title }) => title));
    expect([...singleConnectionSkips].filter((title) => !titles.has(title))).toEqual([]);
  });
  // #endhide

  for (const conformanceCase of cases.filter(({ title }) => !singleConnectionSkips.has(title))) {
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
