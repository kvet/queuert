import { type ConformanceTestCase, toConformanceTestCases } from "../conformance/suite.ts";
import { validationAdapterConformanceGroups } from "./groups.ts";
import type { ValidationAdapterConformanceContext } from "./types.ts";

/**
 * The validation adapter conformance cases, to run one per test in your own test file. The
 * context holds builders whose return types encode the job types the cases expect, so the
 * adapter's schema-to-shape inference is checked at compile time as well as at run time. Works
 * with any test runner.
 *
 * @example
 * ```ts
 * import { test } from "vitest";
 *
 * const context: ValidationAdapterConformanceContext = {
 *   basic: { buildEntry: () => createMyJobTypes({ ... }) },
 *   // ... continuations, blockers, external
 * };
 *
 * for (const conformanceCase of validationAdapterConformanceCases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const validationAdapterConformanceCases: ConformanceTestCase<ValidationAdapterConformanceContext>[] =
  toConformanceTestCases(validationAdapterConformanceGroups);
