import { describe, expect, it } from "vitest";

import { sleep } from "../helpers/sleep.js";
import {
  ConformanceError,
  type ConformanceGroup,
  type ConformanceResult,
  runConformance,
} from "./runner.js";

type Ctx = { counter: { value: number } };

const trivialCases = (run: (ctx: Ctx) => Promise<void>): ConformanceGroup<Ctx>[] => [
  { name: "group", cases: [{ name: "case", run }] },
];

describe("runConformance", () => {
  it("runs all cases and returns pass report when everything succeeds", async () => {
    const groups: ConformanceGroup<Ctx>[] = [
      {
        name: "arith",
        cases: [
          {
            name: "adds",
            run: async (_ctx, expect) => {
              expect(1 + 1).toBe(2);
            },
          },
          {
            name: "multiplies",
            run: async (_ctx, expect) => {
              expect(2 * 3).toBe(6);
            },
          },
        ],
      },
      {
        name: "strings",
        cases: [
          {
            name: "concats",
            run: async (_ctx, expect) => {
              expect("a" + "b").toBe("ab");
            },
          },
        ],
      },
    ];

    const report = await runConformance(groups, {
      setup: async () => ({ context: { counter: { value: 0 } } }),
    });

    expect(report.total).toBe(3);
    expect(report.passed).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.results.map((r) => r.status)).toEqual(["pass", "pass", "pass"]);
  });

  it("flattens group + case name with ' > ' separator", async () => {
    const groups: ConformanceGroup<Ctx>[] = [
      { name: "outer", cases: [{ name: "inner", run: async () => {} }] },
    ];

    const report = await runConformance(groups, {
      setup: async () => ({ context: { counter: { value: 0 } } }),
    });

    expect(report.results[0].name).toBe("outer > inner");
  });

  it("throws ConformanceError aggregating every failure", async () => {
    const groups: ConformanceGroup<Ctx>[] = [
      {
        name: "group",
        cases: [
          {
            name: "passing",
            run: async (_ctx, expect) => {
              expect(1).toBe(1);
            },
          },
          {
            name: "failing a",
            run: async (_ctx, expect) => {
              expect(1).toBe(2);
            },
          },
          {
            name: "failing b",
            run: async () => {
              throw new Error("boom");
            },
          },
        ],
      },
    ];

    const error = await runConformance(groups, {
      setup: async () => ({ context: { counter: { value: 0 } } }),
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ConformanceError);
    const conformanceError = error as ConformanceError;
    expect(conformanceError.report.total).toBe(3);
    expect(conformanceError.report.passed).toBe(1);
    expect(conformanceError.report.failed).toBe(2);
    expect(conformanceError.report.results.map((r) => r.status)).toEqual(["pass", "fail", "fail"]);
    expect(conformanceError.message).toContain("2/3 conformance cases failed");
    expect(conformanceError.message).toContain("group > failing a");
    expect(conformanceError.message).toContain("group > failing b");
    expect(conformanceError.message).toContain("boom");

    const cause = conformanceError.cause as AggregateError;
    expect(cause).toBeInstanceOf(AggregateError);
    expect(cause.errors).toHaveLength(2);
    expect((cause.errors[1] as Error).message).toBe("boom");
  });

  it("invokes setup and cleanup once per case in correct order", async () => {
    const events: string[] = [];
    const groups: ConformanceGroup<Ctx>[] = [
      {
        name: "group",
        cases: [
          {
            name: "first",
            run: async () => {
              events.push("run first");
            },
          },
          {
            name: "second",
            run: async () => {
              events.push("run second");
            },
          },
        ],
      },
    ];

    let idx = 0;
    await runConformance(groups, {
      setup: async () => {
        const id = idx++;
        events.push(`setup ${id}`);
        return {
          context: { counter: { value: id } },
          cleanup: async () => {
            events.push(`cleanup ${id}`);
          },
        };
      },
    });

    expect(events).toEqual([
      "setup 0",
      "run first",
      "cleanup 0",
      "setup 1",
      "run second",
      "cleanup 1",
    ]);
  });

  it("runs cleanup even when case fails", async () => {
    let cleanedUp = false;
    await runConformance(
      trivialCases(async () => Promise.reject(new Error("nope"))),
      {
        setup: async () => ({
          context: { counter: { value: 0 } },
          cleanup: async () => {
            cleanedUp = true;
          },
        }),
      },
    ).catch(() => {});
    expect(cleanedUp).toBe(true);
  });

  it("surfaces cleanup error when the case itself passed", async () => {
    const error = (await runConformance(
      trivialCases(async () => {}),
      {
        setup: async () => ({
          context: { counter: { value: 0 } },
          cleanup: async () => {
            throw new Error("cleanup boom");
          },
        }),
      },
    ).catch((err: unknown) => err)) as ConformanceError;

    expect(error).toBeInstanceOf(ConformanceError);
    expect(error.report.results[0].error?.message).toBe("cleanup boom");
  });

  it("prefers the case error over a subsequent cleanup error", async () => {
    const error = (await runConformance(
      trivialCases(async () => Promise.reject(new Error("case boom"))),
      {
        setup: async () => ({
          context: { counter: { value: 0 } },
          cleanup: async () => {
            throw new Error("cleanup boom");
          },
        }),
      },
    ).catch((err: unknown) => err)) as ConformanceError;

    expect(error.report.results[0].error?.message).toBe("case boom");
  });

  it("marks setup failure as a case failure", async () => {
    const error = (await runConformance(
      trivialCases(async () => {}),
      {
        setup: async () => {
          throw new Error("setup exploded");
        },
      },
    ).catch((err: unknown) => err)) as ConformanceError;

    expect(error.report.failed).toBe(1);
    expect(error.report.results[0].error?.message).toBe("setup exploded");
  });

  it("invokes onResult hook for every case in order", async () => {
    const seen: Pick<ConformanceResult, "name" | "status">[] = [];
    const groups: ConformanceGroup<Ctx>[] = [
      {
        name: "group",
        cases: [
          { name: "pass", run: async () => {} },
          {
            name: "fail",
            run: async () => {
              throw new Error("x");
            },
          },
        ],
      },
    ];

    await runConformance(groups, {
      setup: async () => ({ context: { counter: { value: 0 } } }),
      onResult: (result) => seen.push({ name: result.name, status: result.status }),
    }).catch(() => {});

    expect(seen).toEqual([
      { name: "group > pass", status: "pass" },
      { name: "group > fail", status: "fail" },
    ]);
  });

  it("enforces caseTimeoutMs on the case body", async () => {
    const error = (await runConformance(
      trivialCases(async () => sleep(200)),
      {
        setup: async () => ({ context: { counter: { value: 0 } } }),
        caseTimeoutMs: 50,
      },
    ).catch((err: unknown) => err)) as ConformanceError;

    expect(error.report.results[0].error?.message).toMatch(/timed out after 50ms/);
  });

  it("enforces setupTimeoutMs on the setup callback", async () => {
    const error = (await runConformance(
      trivialCases(async () => {}),
      {
        setup: async () => {
          await sleep(200);
          return { context: { counter: { value: 0 } } };
        },
        setupTimeoutMs: 50,
      },
    ).catch((err: unknown) => err)) as ConformanceError;

    expect(error.report.results[0].error?.message).toMatch(/setup .* timed out after 50ms/);
  });

  it("enforces cleanupTimeoutMs on the cleanup callback", async () => {
    const error = (await runConformance(
      trivialCases(async () => {}),
      {
        setup: async () => ({
          context: { counter: { value: 0 } },
          cleanup: async () => sleep(200),
        }),
        cleanupTimeoutMs: 50,
      },
    ).catch((err: unknown) => err)) as ConformanceError;

    expect(error.report.results[0].error?.message).toMatch(/cleanup .* timed out after 50ms/);
  });

  it("returns zero-case report when no groups provided", async () => {
    const report = await runConformance<Ctx>([], {
      setup: async () => ({ context: { counter: { value: 0 } } }),
    });

    expect(report.total).toBe(0);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.results).toEqual([]);
  });

  it("marks case as skipped when expect.skip is called", async () => {
    const groups: ConformanceGroup<Ctx>[] = [
      {
        name: "group",
        cases: [
          {
            name: "skippy",
            run: async (_ctx, expect) => {
              expect.skip("backend does not support X");
            },
          },
          {
            name: "normal",
            run: async (_ctx, expect) => {
              expect(1).toBe(1);
            },
          },
        ],
      },
    ];

    const report = await runConformance(groups, {
      setup: async () => ({ context: { counter: { value: 0 } } }),
    });

    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.results[0].status).toBe("skip");
    expect(report.results[0].skipReason).toBe("backend does not support X");
    expect(report.results[1].status).toBe("pass");
  });

  it("does not abort the run when onResult throws", async () => {
    const seen: string[] = [];
    const groups: ConformanceGroup<Ctx>[] = [
      {
        name: "group",
        cases: [
          {
            name: "first",
            run: async () => {
              seen.push("first");
            },
          },
          {
            name: "second",
            run: async () => {
              seen.push("second");
            },
          },
        ],
      },
    ];

    const report = await runConformance(groups, {
      setup: async () => ({ context: { counter: { value: 0 } } }),
      onResult: () => {
        throw new Error("logger exploded");
      },
    });

    expect(seen).toEqual(["first", "second"]);
    expect(report.passed).toBe(2);
  });

  it("records cleanup error separately when case already failed", async () => {
    const error = (await runConformance(
      trivialCases(async () => Promise.reject(new Error("case boom"))),
      {
        setup: async () => ({
          context: { counter: { value: 0 } },
          cleanup: async () => {
            throw new Error("cleanup boom");
          },
        }),
      },
    ).catch((err: unknown) => err)) as ConformanceError;

    expect(error.report.results[0].error?.message).toBe("case boom");
    expect(error.report.results[0].cleanupError?.message).toBe("cleanup boom");
    expect(error.message).toContain("Cleanup errors (1)");
    expect(error.message).toContain("cleanup boom");
    const cause = error.cause as AggregateError;
    expect(cause.errors.map((e) => (e as Error).message)).toEqual(["case boom", "cleanup boom"]);
  });

  it("includes cleanup errors from passing cases in ConformanceError cause", async () => {
    const error = (await runConformance(
      [
        {
          name: "group",
          cases: [
            {
              name: "passes but cleanup fails",
              run: async () => {},
            },
            {
              name: "fails outright",
              run: async () => Promise.reject(new Error("case boom")),
            },
          ],
        },
      ],
      {
        setup: async () => ({
          context: { counter: { value: 0 } },
          cleanup: async () => {
            throw new Error("cleanup boom");
          },
        }),
      },
    ).catch((err: unknown) => err)) as ConformanceError;

    expect(error).toBeInstanceOf(ConformanceError);
    expect(error.report.results[0].status).toBe("fail");
    expect(error.report.results[0].error?.message).toBe("cleanup boom");
    expect(error.report.results[1].error?.message).toBe("case boom");
    expect(error.report.results[1].cleanupError?.message).toBe("cleanup boom");
    expect(error.message).toContain("Cleanup errors");
  });

  it("reports duration using performance.now (non-negative finite number)", async () => {
    const report = await runConformance(
      trivialCases(async () => sleep(5)),
      {
        setup: async () => ({ context: { counter: { value: 0 } } }),
      },
    );

    const duration = report.results[0].durationMs;
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(duration)).toBe(true);
  });
});
