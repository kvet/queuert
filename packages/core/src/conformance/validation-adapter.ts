import { type ConformanceReport, type ConformanceResult, runConformance } from "./runner.js";
import {
  type ValidationAdapterConformanceContext,
  type ValidationConformanceFixture,
  validationAdapterConformanceGroups,
} from "./validation-adapter-cases.js";

export type ValidationConformanceOptions = {
  caseTimeoutMs?: number;
  onResult?: (result: ConformanceResult) => void;
};

/**
 * Run the validation adapter conformance suite against a user-supplied
 * adapter. Test-framework agnostic: designed to be embedded in a single test
 * (vitest `test()`, bun `test()`, `node:test`, etc.). Throws
 * {@link ConformanceError} with an aggregated report on any failure.
 *
 * Each builder under `basic`, `continuations`, `blockers`, and `external` is
 * typed with the precise phantom job type definitions the suite expects.
 * The adapter under test must thread its schema-to-shape inference correctly
 * to satisfy these return types — TypeScript rejects the factory value at
 * the runner call site otherwise. This is what makes the suite a combined
 * runtime AND type-level conformance check.
 *
 * @example
 * ```ts
 * await runValidationAdapterConformance(async () => ({
 *   basic: {
 *     buildEntry: () => createMyJobTypes({
 *       main: { entry: true, input: schema({ id: "string" }), output: schema({ ok: "boolean" }) },
 *     }),
 *     // ... other required builders
 *   },
 *   continuations: { buildNominal: () => ..., buildStructural: () => ... },
 *   blockers:      { buildNominal: () => ..., buildStructural: () => ... },
 *   external:      { buildWithExternalSlice: () => ... },
 * }));
 * ```
 */
export const runValidationAdapterConformance = async (
  factory: () => Promise<ValidationConformanceFixture>,
  options?: ValidationConformanceOptions,
): Promise<ConformanceReport> => {
  const fixture = await factory();
  try {
    return await runConformance(validationAdapterConformanceGroups, {
      setup: async () => ({
        context: {
          basic: fixture.basic,
          continuations: fixture.continuations,
          blockers: fixture.blockers,
          external: fixture.external,
        } satisfies ValidationAdapterConformanceContext,
      }),
      caseTimeoutMs: options?.caseTimeoutMs,
      onResult: options?.onResult,
    });
  } finally {
    if (fixture.dispose) await fixture.dispose();
  }
};

export {
  type ValidationAdapterConformanceContext,
  type ValidationConformanceFixture,
} from "./validation-adapter-cases.js";
