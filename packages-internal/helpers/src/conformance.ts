import { type TestAPI, describe } from "vitest";

export const conformanceTestSuite = <TFixtures extends { conformance: unknown }>({
  it,
  groups,
  mode,
}: {
  it: TestAPI<TFixtures>;
  groups: {
    name: string;
    cases: {
      name: string;
      mode?: "async" | "sync";
      run: (context: TFixtures["conformance"]) => Promise<void>;
    }[];
  }[];
  /** Leaves out the cases that run only in the other adapter mode. */
  mode: "async" | "sync";
}): void => {
  for (const group of groups) {
    const cases = group.cases.filter(
      (testCase) => testCase.mode === undefined || testCase.mode === mode,
    );
    if (cases.length === 0) continue;
    describe(group.name, () => {
      for (const testCase of cases) {
        it(testCase.name, async ({ conformance }) => {
          await testCase.run(conformance);
        });
      }
    });
  }
};
