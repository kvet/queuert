import { type TestAPI, describe } from "vitest";

import { expect } from "../conformance/expect.ts";
import { type ConformanceGroup, SkipSignalError } from "../conformance/runner.ts";

export type ConformanceFixtures<TContext> = {
  conformance: TContext & { reset?: () => Promise<void> };
};

export const conformanceTestSuite = <TContext, TFixtures extends ConformanceFixtures<TContext>>({
  it,
  groups,
}: {
  it: TestAPI<TFixtures>;
  groups: ConformanceGroup<TContext>[];
}): void => {
  for (const group of groups) {
    describe(group.name, () => {
      for (const testCase of group.cases) {
        it(testCase.name, async ({ conformance, skip }) => {
          const { reset, ...context } = conformance;
          if (reset) await reset();
          try {
            await testCase.run(context as TContext, expect);
          } catch (error) {
            if (error instanceof SkipSignalError) {
              skip(error.reason);
              return;
            }
            throw error;
          }
        });
      }
    });
  }
};
