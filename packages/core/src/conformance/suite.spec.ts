import { describe, expect, it } from "vitest";

import type { ConformanceGroup } from "./runner.ts";
import { toConformanceTestCases } from "./suite.ts";

type Ctx = { log: string[] };

const groups: ConformanceGroup<Ctx>[] = [
  {
    name: "first",
    cases: [
      {
        name: "a",
        run: async (ctx) => {
          ctx.log.push("run a");
        },
      },
      {
        name: "b",
        run: async (ctx) => {
          ctx.log.push("run b");
        },
      },
    ],
  },
  {
    name: "second",
    cases: [
      {
        name: "fails",
        run: async (_ctx, expect) => expect.fail("boom"),
      },
    ],
  },
];

describe("toConformanceTestCases", () => {
  it("lists every case with its group and title, in order", () => {
    expect(
      toConformanceTestCases(groups).map(({ group, name, title }) => ({ group, name, title })),
    ).toEqual([
      { group: "first", name: "a", title: "first > a" },
      { group: "first", name: "b", title: "first > b" },
      { group: "second", name: "fails", title: "second > fails" },
    ]);
  });

  it("rejects naming the case when the context is undefined", async () => {
    const context = undefined as unknown as Ctx;

    await expect(toConformanceTestCases(groups)[0].run(context)).rejects.toThrow(
      'No conformance context for "first > a": the hook that creates it did not run or failed',
    );
  });

  it("runs each case against the context as given", async () => {
    const log: string[] = [];

    for (const conformanceCase of toConformanceTestCases(groups.slice(0, 1))) {
      await conformanceCase.run({ log });
    }

    expect(log).toEqual(["run a", "run b"]);
  });

  it("rejects with the case's error when it fails", async () => {
    const [conformanceCase] = toConformanceTestCases<Ctx>([
      {
        name: "g",
        cases: [
          {
            name: "throws",
            run: async () => {
              throw new Error("boom");
            },
          },
        ],
      },
    ]);

    await expect(conformanceCase.run({ log: [] })).rejects.toThrow("boom");
  });
});
