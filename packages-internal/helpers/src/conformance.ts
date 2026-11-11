import { type TestAPI, describe } from "vitest";

export const conformanceTestSuite = <TFixtures extends { conformance: unknown }>({
  it,
  groups,
}: {
  it: TestAPI<TFixtures>;
  groups: {
    name: string;
    cases: {
      name: string;
      run: (context: TFixtures["conformance"]) => Promise<void>;
    }[];
  }[];
}): void => {
  for (const group of groups) {
    describe(group.name, () => {
      for (const testCase of group.cases) {
        it(testCase.name, async ({ conformance }) => {
          await testCase.run(conformance);
        });
      }
    });
  }
};
