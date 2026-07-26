import { type JobTypeDefs } from "../entities/job-type.js";
import { type JobTypes, createJobTypes } from "../entities/job-types.js";

/** Type name of the built-in cleanup job. */
export const cleanupJobTypeName = "__queuert/cleanup";

/**
 * Input of the built-in cleanup job.
 *
 * - `retentionMs` — completed chains that finished longer ago than this are deleted.
 * - `intervalMs` — delay before the next run, which the handler schedules itself.
 */
export type CleanupJobInput = {
  retentionMs: number;
  intervalMs: number;
};

/** Job type definitions registered by {@link createCleanupJobTypes}. */
export type CleanupJobTypeDefinitions = JobTypeDefs<{
  "__queuert/cleanup": {
    entry: true;
    input: CleanupJobInput;
    output: null;
  };
}>;

const assertCleanupTypeName = (typeName: string): void => {
  if (typeName !== cleanupJobTypeName) {
    throw new Error(`Unknown job type "${typeName}"`);
  }
};

const parseDurationMs = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`"${field}" must be a finite non-negative number`);
  }
  return value;
};

/**
 * Job types for the built-in cleanup processor. Pass alongside your own slices:
 *
 * @example
 * const client = await createClient({
 *   stateAdapter,
 *   notifyAdapter,
 *   jobTypes: [createCleanupJobTypes(), myJobTypes],
 * });
 */
export const createCleanupJobTypes = (): JobTypes<CleanupJobTypeDefinitions> =>
  createJobTypes<CleanupJobTypeDefinitions>({
    getTypeNames: () => [cleanupJobTypeName],
    validateEntry: (typeName) => {
      assertCleanupTypeName(typeName);
    },
    parseInput: (typeName, input) => {
      assertCleanupTypeName(typeName);
      if (typeof input !== "object" || input === null) {
        throw new Error("input must be an object");
      }
      const { retentionMs, intervalMs } = input as Record<string, unknown>;
      return {
        retentionMs: parseDurationMs(retentionMs, "retentionMs"),
        intervalMs: parseDurationMs(intervalMs, "intervalMs"),
      } satisfies CleanupJobInput;
    },
    parseOutput: (typeName, output) => {
      assertCleanupTypeName(typeName);
      if (output !== null) {
        throw new Error("output must be null");
      }
      return output;
    },
    validateContinueWith: (typeName) => {
      assertCleanupTypeName(typeName);
      throw new Error(`"${cleanupJobTypeName}" has no continuation`);
    },
    validateBlockers: (typeName, blockers) => {
      assertCleanupTypeName(typeName);
      if (blockers.length > 0) {
        throw new Error(`"${cleanupJobTypeName}" takes no blockers`);
      }
    },
  });
