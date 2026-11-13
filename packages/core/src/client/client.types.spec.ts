import { describe, expectTypeOf, it } from "vitest";

import { defineJobTypes } from "../job-types/define-job-types.ts";
import type { JobTypes } from "../job-types/job-types.ts";
import type { InProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { GetStateAdapterTxContext } from "../state-adapter/state-adapter.ts";
import type { createClient } from "./client.ts";

type InProcessClient<TJobTypes extends JobTypes<any>> = ReturnType<
  typeof createClient<TJobTypes, InProcessStateAdapter>
>;

declare const txCtx: GetStateAdapterTxContext<InProcessStateAdapter>;

describe("createChain", () => {
  const jobTypes = defineJobTypes<{
    test: { entry: true; input: { value: number }; output: null };
  }>();
  const blockedJobTypes = defineJobTypes<{
    dep: { entry: true; input: null; output: null };
    withBlocker: {
      entry: true;
      input: { value: number };
      output: null;
      blockers: [{ typeName: "dep" }];
    };
  }>();

  it("rejects wrong input type at compile time", () => {
    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) =>
      client.createChain({
        ...txCtx,
        typeName: "test",
        // @ts-expect-error wrong input type
        input: { wrong: "field" },
      }),
    ).toBeFunction();
  });

  it("rejects non-entry type name at compile time", () => {
    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) =>
      client.createChain({
        ...txCtx,
        // @ts-expect-error non-existent type
        typeName: "nonexistent",
        input: { value: 0 },
      }),
    ).toBeFunction();
  });

  it("requires blockers when defined at compile time", () => {
    expectTypeOf(async (client: InProcessClient<typeof blockedJobTypes>) =>
      // @ts-expect-error missing required blockers
      client.createChain({
        ...txCtx,
        typeName: "withBlocker",
        input: { value: 1 },
      }),
    ).toBeFunction();
  });

  it("types a single blocker slot as required", () => {
    const singleSlotJobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { done: true };
        continueWith: { typeName: "blocker" };
      };
      main: {
        entry: true;
        input: { start: boolean };
        output: { finalResult: number };
        blockers: [{ typeName: "blocker" }];
      };
    }>();

    expectTypeOf((client: InProcessClient<typeof singleSlotJobTypes>) => {
      expectTypeOf<
        Parameters<typeof client.createChain<"main">>[0]["blockers"]
      >().not.toBeUndefined();
    }).toBeFunction();
  });

  it("accepts blockers by id only where the slot type allows it", () => {
    const slotJobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      other: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      main: {
        entry: true;
        input: null;
        output: { sum: number };
        blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" | "other" }[]];
      };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof slotJobTypes>) => {
      const blockerChain = await client.createChain({
        ...txCtx,
        typeName: "blocker",
        input: { value: 1 },
      });
      const otherChain = await client.createChain({
        ...txCtx,
        typeName: "other",
        input: { value: 10 },
      });

      type MainBlockers = Parameters<typeof client.createChain<"main">>[0]["blockers"];
      expectTypeOf<[{ id: string }]>().toExtend<MainBlockers>();
      expectTypeOf<[typeof blockerChain, typeof otherChain]>().toExtend<MainBlockers>();
      expectTypeOf<[{ id: string; typeName: "other" }]>().not.toExtend<MainBlockers>();
    }).toBeFunction();
  });
});

describe("createChains", () => {
  const jobTypes = defineJobTypes<{
    test: { entry: true; input: { value: number }; output: null };
  }>();
  const blockedJobTypes = defineJobTypes<{
    dep: { entry: true; input: null; output: null };
    withBlocker: {
      entry: true;
      input: { value: number };
      output: null;
      blockers: [{ typeName: "dep" }];
    };
  }>();

  it("rejects non-entry type name in batch at compile time", () => {
    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) =>
      client.createChains({
        ...txCtx,
        items: [
          // @ts-expect-error non-existent type
          { typeName: "nonexistent", input: { value: 0 } },
        ],
      }),
    ).toBeFunction();
  });

  it("rejects wrong input type in batch at compile time", () => {
    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) =>
      client.createChains({
        ...txCtx,
        items: [
          // @ts-expect-error wrong input for test
          { typeName: "test", input: { wrong: "field" } },
        ],
      }),
    ).toBeFunction();
  });

  it("rejects missing blockers in batch at compile time", () => {
    expectTypeOf(async (client: InProcessClient<typeof blockedJobTypes>) =>
      client.createChains({
        ...txCtx,
        items: [
          // @ts-expect-error missing required blockers for withBlocker
          { typeName: "withBlocker", input: { value: 1 } },
        ],
      }),
    ).toBeFunction();
  });
});

describe("queries", () => {
  const jobTypes = defineJobTypes<{
    order: {
      entry: true;
      input: { amount: number };
      output: { receipt: string };
      continueWith: { typeName: "order_fulfill" };
    };
    order_fulfill: {
      input: { orderId: string };
      output: { shipped: boolean };
    };
    notification: {
      entry: true;
      input: { message: string };
      output: { sent: boolean };
    };
    report: {
      entry: true;
      input: { type: string };
      output: { data: string };
      blockers: [{ typeName: "order" }];
    };
  }>();
  type QueryClient = InProcessClient<typeof jobTypes>;

  it("getChain narrows return type by typeName", () => {
    expectTypeOf(async (client: QueryClient) => {
      const chain = await client.getChain({ typeName: "notification", id: "notification-id" });

      expectTypeOf(chain!.typeName).toEqualTypeOf<"notification">();
    }).toBeFunction();
  });

  it("getChains narrows return type by typeName", () => {
    expectTypeOf(async (client: QueryClient) => {
      const chains = await client.getChains({ typeName: "notification", ids: ["notification-id"] });

      expectTypeOf(chains[0]!.typeName).toEqualTypeOf<"notification">();
    }).toBeFunction();
  });

  it("getJobs narrows return type by typeName", () => {
    expectTypeOf(async (client: QueryClient) => {
      const jobs = await client.getJobs({ typeName: "notification", ids: ["notification-id"] });

      expectTypeOf(jobs[0]!.typeName).toEqualTypeOf<"notification">();
    }).toBeFunction();
  });

  it("listChainJobs narrows return type when typeName is provided", () => {
    expectTypeOf(async (client: QueryClient) => {
      const page = await client.listChainJobs({ chainId: "order-id", chainTypeName: "order" });

      expectTypeOf(page.items[0].typeName).toEqualTypeOf<"order" | "order_fulfill">();
      expectTypeOf(page.items[0].input).toEqualTypeOf<{ amount: number } | { orderId: string }>();
    }).toBeFunction();
  });

  it("getJobBlockers resolves typed blockers when typeName is provided", () => {
    expectTypeOf(async (client: QueryClient) => {
      const blockers = await client.getJobBlockers({ jobId: "report-id", typeName: "report" });

      expectTypeOf(blockers[0].typeName).toEqualTypeOf<"order">();
    }).toBeFunction();
  });

  it("listBlockedJobs narrows return type when typeName is provided", () => {
    expectTypeOf(async (client: QueryClient) => {
      const page = await client.listBlockedJobs({ chainId: "order-id", typeName: "order" });

      expectTypeOf(page.items[0].typeName).toEqualTypeOf<"report">();
      expectTypeOf(page.items[0].input).toEqualTypeOf<{ type: string }>();
    }).toBeFunction();
  });
});

describe("completeChain", () => {
  it("types a simple chain completed without worker", () => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { value: number }; output: { result: number } };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      const chain = await client.createChain({
        ...txCtx,
        typeName: "test",
        input: { value: 42 },
      });
      const completedChain = await client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { result: 84 } })),
      });

      expectTypeOf(completedChain.status).toEqualTypeOf<"completed">();
      expectTypeOf(completedChain.output).toEqualTypeOf<{ result: number }>();
    }).toBeFunction();
  });

  it("types a complex chain completed without worker", () => {
    const jobTypes = defineJobTypes<{
      "awaiting-approval": {
        entry: true;
        input: { requestId: string };
        continueWith: { typeName: "process-approved" };
      };
      "process-approved": { input: { approved: boolean }; output: { done: boolean } };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      const chain = await client.createChain({
        ...txCtx,
        typeName: "awaiting-approval",
        input: { requestId: "req-123" },
      });
      const completedChain = await client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName === "awaiting-approval") {
            job = await completeJob(job, async ({ complete }) =>
              complete({
                continueWith: { typeName: "process-approved", input: { approved: true } },
              }),
            );
            expectTypeOf<(typeof job)["typeName"]>().toEqualTypeOf<"process-approved">();
            return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
          }
          return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
        },
      });

      expectTypeOf(completedChain.status).toEqualTypeOf<"completed">();
    }).toBeFunction();
  });

  it("rejects continueWith typeName/input mismatches in completeChain", () => {
    const jobTypes = defineJobTypes<{
      start: { entry: true; input: { requestId: string }; continueWith: { typeName: "step-a" } };
      "step-a": { input: { valueA: number }; continueWith: { typeName: "step-b" } };
      "step-b": { input: { valueB: boolean }; output: { result: string } };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      const chain = await client.createChain({
        ...txCtx,
        typeName: "start",
        input: { requestId: "req-1" },
      });
      await client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) => {
          // @ts-expect-error complete({ output: ... }) rejects un-narrowed union job types
          void completeJob(job, async ({ complete }) => complete({ output: { result: "done" } }));
        },
      });
    }).toBeFunction();
  });

  it("rejects a continueWith blocker whose chain type the slot does not accept", () => {
    const jobTypes = defineJobTypes<{
      blocker: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      other: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
      first: {
        entry: true;
        input: { blockerId: string; otherId: string };
        continueWith: { typeName: "second" };
      };
      second: {
        input: null;
        output: { sum: number };
        blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" | "other" }[]];
      };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      const chain = await client.createChain({
        ...txCtx,
        typeName: "first",
        input: { blockerId: "blocker-id", otherId: "other-id" },
      });
      await client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName !== "first") return;
          await completeJob(job, async ({ complete }) => {
            void complete({
              continueWith: {
                typeName: "second",
                input: null,
                // @ts-expect-error the first blocker slot only accepts "blocker"
                blockers: [{ id: "other-id", typeName: "other" }],
              },
            });

            return complete({
              continueWith: {
                typeName: "second",
                input: null,
                blockers: [{ id: "other-id", typeName: "blocker" }],
              },
            });
          });
        },
      });
    }).toBeFunction();
  });

  it("types a partially completed chain", () => {
    const jobTypes = defineJobTypes<{
      "awaiting-approval": {
        entry: true;
        input: { requestId: string };
        continueWith: { typeName: "process-approved" };
      };
      "process-approved": { input: { approved: boolean }; output: { done: true } };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      const chain = await client.createChain({
        ...txCtx,
        typeName: "awaiting-approval",
        input: { requestId: "req-123" },
      });
      const partiallyCompletedChain = await client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName === "awaiting-approval") {
            job = await completeJob(job, async ({ complete }) =>
              complete({
                continueWith: { typeName: "process-approved", input: { approved: true } },
              }),
            );
            expectTypeOf<(typeof job)["typeName"]>().toEqualTypeOf<"process-approved">();
          }
        },
      });

      const succeededChain = await client.awaitChain(partiallyCompletedChain, { timeoutMs: 0 });
      expectTypeOf(succeededChain.status).toEqualTypeOf<"completed">();
    }).toBeFunction();
  });

  it("narrows chainTypeName in completeChain", () => {
    const jobTypes = defineJobTypes<{
      entryA: { entry: true; input: null; continueWith: { typeName: "shared" } };
      entryB: { entry: true; input: null; continueWith: { typeName: "shared" } };
      shared: { input: null; output: { done: boolean } };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      const chain = await client.createChain({
        ...txCtx,
        typeName: "entryA",
        input: null,
      });
      await client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) => {
          expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();

          if (job.typeName === "entryA") {
            job = await completeJob(job, async ({ complete }) =>
              complete({ continueWith: { typeName: "shared", input: null } }),
            );
          }

          expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();

          return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
        },
      });
    }).toBeFunction();
  });

  it("types the terminal transition applied inline", () => {
    const jobTypes = defineJobTypes<{
      review: {
        entry: true;
        input: { requestId: string };
        output: { approved: boolean };
        continueWith: { typeName: "archive" };
      };
      archive: { input: { requestId: string }; output: { archived: boolean } };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      const chain = await client.createChain({
        ...txCtx,
        typeName: "review",
        input: { requestId: "req-1" },
      });
      const completedChain = await client.completeChain({
        ...txCtx,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName !== "review") throw new Error("unexpected job type");
          return completeJob(job, async ({ complete }) => complete({ output: { approved: true } }));
        },
      });

      expectTypeOf(completedChain.status).toEqualTypeOf<"completed">();
    }).toBeFunction();
  });
});
