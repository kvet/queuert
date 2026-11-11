import type { ConformanceGroup } from "./runner.ts";

/**
 * One conformance case, to wrap in a test of any test runner. The test file creates the context
 * before the cases (for example in `beforeAll`) and releases the resources behind it, such as the
 * database, after them.
 *
 * The cases of a list share one context, so run them one at a time: not with `test.concurrent`,
 * vitest's `sequence.concurrent` or another runner's concurrent mode.
 */
export type ConformanceTestCase<TContext> = {
  /** The group the case belongs to, such as `createJobs`. */
  group: string;
  /** The case's own name, without its group. */
  name: string;
  /** A test name made of the group and the case's name: `<group> > <name>`. */
  title: string;
  /**
   * Runs the case against the context. Resolves when the case passes and rejects when it fails.
   *
   * @throws Error if `context` is `undefined`, as when the hook that creates it failed.
   */
  run: (context: TContext) => Promise<void>;
};

export const toConformanceTestCases = <TContext>(
  groups: ConformanceGroup<TContext>[],
): ConformanceTestCase<TContext>[] =>
  groups.flatMap((group) =>
    group.cases.map<ConformanceTestCase<TContext>>((testCase) => ({
      group: group.name,
      name: testCase.name,
      title: `${group.name} > ${testCase.name}`,
      run: async (context) => {
        if (context === undefined) {
          throw new Error(
            `No conformance context for "${group.name} > ${testCase.name}": the hook that creates it did not run or failed`,
          );
        }
        await testCase.run(context);
      },
    })),
  );
