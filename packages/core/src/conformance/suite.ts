import type { ConformanceGroup } from "./runner.ts";

/**
 * One conformance case, already bound to the context of the suite that created it, to wrap in a
 * test of any test runner. The test file owns the resources the suite's callbacks reach, such as
 * the pool or the client, and releases them after the cases.
 *
 * The cases of a suite share one context, so run them one at a time: not with `test.concurrent`,
 * vitest's `sequence.concurrent` or another runner's concurrent mode.
 */
export type ConformanceTestCase = {
  /** The group the case belongs to, such as `createJobs`. */
  group: string;
  /** The case's own name, without its group. */
  name: string;
  /** A test name made of the group and the case's name: `<group> > <name>`. */
  title: string;
  /** Runs the case. Resolves when the case passes and rejects when it fails. */
  run: () => Promise<void>;
};

export const toConformanceTestCases = <TContext>(
  groups: ConformanceGroup<TContext>[],
  context: TContext,
): ConformanceTestCase[] =>
  groups.flatMap((group) =>
    group.cases.map((testCase) => ({
      group: group.name,
      name: testCase.name,
      title: `${group.name} > ${testCase.name}`,
      run: async () => testCase.run(context),
    })),
  );
