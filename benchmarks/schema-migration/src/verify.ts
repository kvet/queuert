import { isDeepStrictEqual } from "node:util";

import { SchemaFencedError } from "queuert-schema-v1";

import type { Seed } from "./seed.ts";

export type MigratedJob = {
  typeName: string;
  chainId: string;
  chainIndex: number;
  continuedToId: string | null;
  input: unknown;
  output: unknown;
  status: string;
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
  attempt: number;
  consecutiveFailures: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
  lastRescheduleReason: string | null;
  attemptAt: Date | null;
  attemptBy: string | null;
  attemptToken: string | null;
  traceContext: string | null;
  chain: {
    status: string;
    completedAt: Date | null;
    deduplicationKey: string | null;
    traceContext: string | null;
    blocking: boolean;
  };
};

export type ReadJobs = (jobIds: string[]) => Promise<(MigratedJob | undefined)[]>;

export type ReadBlockers = (jobIds: string[]) => Promise<{ id: string }[][]>;

export type Repairs = { releasesOrphans: boolean; unblocksStranded: boolean };

export type Check = { name: string; violations: number };

const batchSize = 500;

export const createFailures = () => {
  const failures = new Map<string, { count: number; examples: string[] }>();
  let compared = 0;
  return {
    compared: () => {
      compared++;
    },
    fail: (field: string, id: string, actual: unknown, expected: unknown) => {
      const entry = failures.get(field) ?? { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 3) {
        entry.examples.push(`${id}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
      }
      failures.set(field, entry);
    },
    checks: (): Check[] => [
      { name: `${compared} values compared`, violations: 0 },
      ...[...failures].map(([name, { count, examples }]) => ({
        name: `${name} (${examples.join("; ")})`,
        violations: count,
      })),
    ],
  };
};

const time = (date: Date | null) => (date === null ? null : date.getTime());

/**
 * Reads every seeded job back through the current adapter and compares it with the schema v1 dump:
 * columns 002 keeps must be unchanged, and the ones it adds or repairs must hold their new values.
 */
export const verifySeedReadback = async ({
  readJobs,
  readBlockers,
  seed,
  repairs,
}: {
  readJobs: ReadJobs;
  readBlockers: ReadBlockers;
  seed: Seed;
  repairs: Repairs;
}): Promise<Check[]> => {
  const { dump, offsetMs, orphanedJobIds, strandedJobIds, blockingChainIds } = seed;
  const chains = new Map(dump.chains.map((chain) => [chain.id, chain]));
  const shifted = (date: Date | null) => (date === null ? null : date.getTime() + offsetMs);
  const { compared, fail, checks } = createFailures();
  for (let start = 0; start < dump.jobs.length; start += batchSize) {
    const expectedJobs = dump.jobs.slice(start, start + batchSize);
    const actualJobs = await readJobs(expectedJobs.map(({ id }) => id));
    for (const [index, expected] of expectedJobs.entries()) {
      const actual = actualJobs[index];
      if (actual === undefined) {
        fail("job missing", expected.id, undefined, expected.status);
        continue;
      }
      const released = repairs.releasesOrphans && orphanedJobIds.has(expected.id);
      const unblocked = repairs.unblocksStranded && strandedJobIds.has(expected.id);
      const chain = chains.get(expected.chainId)!;
      const compare = (field: string, actualValue: unknown, expectedValue: unknown) => {
        compared();
        if (!isDeepStrictEqual(actualValue, expectedValue)) {
          fail(field, expected.id, actualValue, expectedValue);
        }
      };
      compare("typeName", actual.typeName, expected.typeName);
      compare("chainId", actual.chainId, expected.chainId);
      compare("chainIndex", actual.chainIndex, expected.chainIndex);
      compare("continuedToId", actual.continuedToId, expected.continuedToId);
      compare("input", actual.input, expected.input);
      compare("output", actual.output, expected.output);
      compare("status", actual.status, released || unblocked ? "pending" : expected.status);
      compare("createdAt", time(actual.createdAt), shifted(expected.createdAt));
      if (!released && !unblocked) {
        compare("scheduledAt", time(actual.scheduledAt), shifted(expected.scheduledAt));
      }
      compare("completedAt", time(actual.completedAt), shifted(expected.completedAt));
      compare("completedBy", actual.completedBy, expected.completedBy);
      compare("attempt", actual.attempt, expected.attempt);
      compare(
        "consecutiveFailures",
        actual.consecutiveFailures,
        expected.lastAttemptError === null ? 0 : 1,
      );
      compare("lastAttemptAt", time(actual.lastAttemptAt), shifted(expected.lastAttemptAt));
      compare("lastAttemptError", actual.lastAttemptError, expected.lastAttemptError);
      compare("lastRescheduleReason", actual.lastRescheduleReason, null);
      compare("attemptAt", time(actual.attemptAt), released ? null : shifted(expected.attemptAt));
      compare("attemptBy", actual.attemptBy, released ? null : expected.attemptBy);
      compare("attemptToken", actual.attemptToken, released ? null : expected.attemptToken);
      compare("traceContext", actual.traceContext, expected.traceContext);
      compare("chain.status", actual.chain.status, chain.status);
      compare("chain.completedAt", time(actual.chain.completedAt), shifted(chain.completedAt));
      compare("chain.deduplicationKey", actual.chain.deduplicationKey, chain.deduplicationKey);
      compare("chain.traceContext", actual.chain.traceContext, chain.traceContext);
      compare("chain.blocking", actual.chain.blocking, blockingChainIds.has(chain.id));
    }
  }
  const blockerChainIds = new Map<string, string[]>();
  for (const { jobId, blockedByChainId } of dump.blockers) {
    blockerChainIds.set(jobId, [...(blockerChainIds.get(jobId) ?? []), blockedByChainId]);
  }
  const blockedJobIds = [...blockerChainIds.keys()];
  for (let start = 0; start < blockedJobIds.length; start += batchSize) {
    const jobIds = blockedJobIds.slice(start, start + batchSize);
    const actualBlockers = await readBlockers(jobIds);
    for (const [index, jobId] of jobIds.entries()) {
      const actual = actualBlockers[index].map(({ id }) => id).toSorted();
      const expected = blockerChainIds.get(jobId)!.toSorted();
      compared();
      if (!isDeepStrictEqual(actual, expected)) fail("blockers", jobId, actual, expected);
    }
  }
  return checks();
};

/** After 002, a schema v1 write must fail with its `SchemaFencedError` and a current write must not. */
export const verifyFence = async ({
  legacyWrite,
  currentWrite,
}: {
  legacyWrite: () => Promise<unknown>;
  currentWrite: () => Promise<unknown>;
}): Promise<Check[]> => {
  const legacyError = await legacyWrite().then(
    () => undefined,
    (error: unknown) => error,
  );
  const currentError = await currentWrite().then(
    () => undefined,
    (error: unknown) => error,
  );
  return [
    {
      name: `schema v1 write not fenced (${String(legacyError)})`,
      violations: legacyError instanceof SchemaFencedError ? 0 : 1,
    },
    {
      name: `current write failed (${String(currentError)})`,
      violations: currentError === undefined ? 0 : 1,
    },
  ];
};
