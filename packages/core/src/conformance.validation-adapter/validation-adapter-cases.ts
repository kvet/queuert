import { type ConformanceTestCase, toConformanceTestCases } from "../conformance/suite.ts";
import { validationAdapterConformanceGroups } from "./groups.ts";
import type { ValidationAdapterConformanceContext } from "./types.ts";

/**
 * Prepares the validation adapter conformance cases, ready to run. The options hold builders whose
 * return types encode the job types the cases expect, so the adapter's schema-to-shape inference
 * is checked at compile time as well as at run time. Works with any test runner.
 *
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { test } from "vitest";
 *
 * const cases = createValidationAdapterConformanceCases({
 *   basic: { buildEntry: () => createMyJobTypes({ ... }) },
 *   // ... continuations, blockers, external
 * });
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 */
export const createValidationAdapterConformanceCases = (
  options: ValidationAdapterConformanceContext,
): ConformanceTestCase[] => toConformanceTestCases(validationAdapterConformanceGroups, options);
