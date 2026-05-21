import { type TestAPI, describe } from "vitest";

import { expect as defaultExpect } from "../conformance/expect.js";
import { SkipSignalError } from "../conformance/runner.js";
import {
  type StateConformanceFixture,
  stateAdapterConformanceGroups,
} from "../conformance/state-adapter-cases.js";

export { type StateConformanceFixture } from "../conformance/state-adapter-cases.js";

/**
 * Run the state adapter conformance cases inside a vitest suite.
 *
 * Shares cases with {@link runStateAdapterConformance} (queuert/conformance).
 * The vitest suite surfaces per-case pass/fail to vitest's reporter while the
 * runner gives end users an embeddable single-test form.
 */
export const stateAdapterConformanceTestSuite = <T extends StateConformanceFixture>({
  it,
}: {
  it: TestAPI<T>;
}): void => {
  for (const group of stateAdapterConformanceGroups) {
    describe(group.name, () => {
      for (const testCase of group.cases) {
        it(
          testCase.name,
          async ({ stateAdapter, generateId, generateInvalidId, poisonTransaction, skip }) => {
            try {
              await testCase.run(
                { stateAdapter, generateId, generateInvalidId, poisonTransaction },
                defaultExpect,
              );
            } catch (err) {
              if (err instanceof SkipSignalError) {
                (skip as unknown as ((note?: string) => void) | undefined)?.(err.reason);
                return;
              }
              throw err;
            }
          },
        );
      }
    });
  }
};
