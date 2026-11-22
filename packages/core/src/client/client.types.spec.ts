import type { UUID } from "node:crypto";

import { describe, expectTypeOf, it } from "vitest";

import { defineJobTypes } from "../job-types/define-job-types.ts";
import type { JobTypes } from "../job-types/job-types.ts";
import type { InProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { GetStateAdapterTxContext, StateAdapter } from "../state-adapter/state-adapter.ts";
import type { createClient } from "./client.ts";

type InProcessClient<
  TJobTypes extends JobTypes<any> | readonly [JobTypes<any>, ...JobTypes<any>[]],
> = ReturnType<typeof createClient<TJobTypes, InProcessStateAdapter<"async">>>;

declare const txCtx: GetStateAdapterTxContext<InProcessStateAdapter<"async">>;

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
      client.createChain(
        // @ts-expect-error non-existent type
        { ...txCtx, typeName: "nonexistent", input: { value: 0 } },
      ),
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
      expectTypeOf<readonly [{ id: string }, { id: string }]>().toExtend<MainBlockers>();
      expectTypeOf<[{ id: string; typeName: "other" }]>().not.toExtend<MainBlockers>();
      expectTypeOf<readonly [{ id: string; typeName: "other" }]>().not.toExtend<MainBlockers>();
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

  it("getChainTailJob and getChainTailJobs narrow return type when chainTypeName is provided", () => {
    expectTypeOf(async (client: QueryClient) => {
      const tailJob = await client.getChainTailJob({ chainId: "order-id", chainTypeName: "order" });
      const tailJobs = await client.getChainTailJobs({
        chainIds: ["order-id"],
        chainTypeName: "order",
      });

      expectTypeOf(tailJob!.typeName).toEqualTypeOf<"order" | "order_fulfill">();
      expectTypeOf(tailJobs[0]!.typeName).toEqualTypeOf<"order" | "order_fulfill">();
      expectTypeOf(tailJobs[0]!.input).toEqualTypeOf<{ amount: number } | { orderId: string }>();
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

describe("locked reads", () => {
  const jobTypes = defineJobTypes<{
    test: { entry: true; input: null; output: null };
  }>();
  type LockClient = InProcessClient<typeof jobTypes>;

  it("accepts a lock only with a transaction context", () => {
    expectTypeOf(async (client: LockClient) => {
      await client.getJob({ ...txCtx, id: "id", lock: "exclusive" });
      await client.getJobs({ ...txCtx, ids: ["id"], lock: "exclusive" });
      await client.getChain({ ...txCtx, id: "id", lock: "exclusive" });
      await client.getChains({ ...txCtx, ids: ["id"], lock: "exclusive" });
      await client.getChainTailJob({ ...txCtx, chainId: "id", lock: "exclusive" });
      await client.getChainTailJobs({ ...txCtx, chainIds: ["id"], lock: "exclusive" });
      // @ts-expect-error lock takes a lock mode, not a boolean
      await client.getJob({ ...txCtx, id: "id", lock: true });
      await client.getJob({ id: "id" });

      // @ts-expect-error lock: "exclusive" requires a transaction context
      await client.getJob({ id: "id", lock: "exclusive" });
      // @ts-expect-error lock: "exclusive" requires a transaction context
      await client.getChainTailJobs({ chainIds: ["id"], lock: "exclusive" });
    }).toBeFunction();
  });
});

describe("applyJobOutcome", () => {
  const jobTypes = defineJobTypes<{
    "await-payment": {
      entry: true;
      input: { orderId: string };
      output: { paid: boolean };
      continueWith: { typeName: "ship" };
    };
    ship: { input: { orderId: string }; output: { shipped: boolean } };
    blocker: { entry: true; input: null; output: null };
    other: { entry: true; input: null; output: null };
    report: {
      entry: true;
      input: null;
      continueWith: { typeName: "summarize" };
    };
    summarize: {
      input: null;
      output: { sum: number };
      blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" | "other" }[]];
    };
  }>();
  type OutcomeClient = InProcessClient<typeof jobTypes>;

  it("types the output result by the job's typeName", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      const completed = await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "await-payment" },
        output: { paid: true },
      });

      expectTypeOf(completed.status).toEqualTypeOf<"completed">();
      expectTypeOf(completed.typeName).toEqualTypeOf<"await-payment">();
      expectTypeOf(completed.output).toEqualTypeOf<{ paid: boolean }>();
      expectTypeOf(completed.continuedTo).toEqualTypeOf<undefined>();
    }).toBeFunction();
  });

  it("types the continueWith result with its continuation", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      const continued = await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "await-payment" },
        continueWith: { typeName: "ship", input: { orderId: "o-1" } },
      });

      expectTypeOf(continued.status).toEqualTypeOf<"completed">();
      expectTypeOf(continued.continuedTo.typeName).toEqualTypeOf<"ship">();
      expectTypeOf(continued.continuedTo.input).toEqualTypeOf<{ orderId: string }>();

      const continuedOnly = await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "report" },
        continueWith: {
          typeName: "summarize",
          input: null,
          blockers: [{ id: "blocker-id", typeName: "blocker" }],
        },
      });

      expectTypeOf(continuedOnly.status).toEqualTypeOf<"completed">();
      expectTypeOf(continuedOnly.continuedTo.typeName).toEqualTypeOf<"summarize">();
    }).toBeFunction();
  });

  it("types the reschedule result as a blocked or pending job", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      const rescheduled = await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id" },
        reschedule: { afterMs: 0 },
        reason: "wake",
      });

      expectTypeOf(rescheduled.status).toEqualTypeOf<"blocked" | "pending">();
    }).toBeFunction();
  });

  it("accepts only a job status as job.status", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", status: "pending" },
        reschedule: { afterMs: 0 },
      });
      await client.applyJobOutcome({
        ...txCtx,
        // @ts-expect-error status must be a job status
        job: { id: "id", status: "paused" },
        reschedule: { afterMs: 0 },
      });
    }).toBeFunction();
  });

  it("applies an outcome to a job read earlier once its typeName is narrowed", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      const job = await client.getChainTailJob({
        ...txCtx,
        chainId: "id",
        chainTypeName: "await-payment",
        lock: "exclusive",
      });
      if (job === undefined) return;

      await client.applyJobOutcome({ ...txCtx, job, reschedule: { afterMs: 0 } });
      // @ts-expect-error output needs a job narrowed to a single type
      await client.applyJobOutcome({ ...txCtx, job, output: { paid: true } });

      if (job.typeName === "await-payment" && job.status !== "completed") {
        const completed = await client.applyJobOutcome({ ...txCtx, job, output: { paid: true } });
        expectTypeOf(completed.chainTypeName).toEqualTypeOf<"await-payment">();
      }
    }).toBeFunction();
  });

  it("rejects an output or continueWith without a typeName", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      // @ts-expect-error output needs job.typeName
      await client.applyJobOutcome({ ...txCtx, job: { id: "id" }, output: { paid: true } });
    }).toBeFunction();
  });

  it("rejects an output, continueWith or input of the wrong type", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "await-payment" },
        // @ts-expect-error output of the wrong shape
        output: { paid: "yes" },
      });
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "ship" },
        // @ts-expect-error ship does not continue
        continueWith: { typeName: "ship", input: { orderId: "o-1" } },
      });
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "await-payment" },
        // @ts-expect-error continuation input of the wrong shape
        continueWith: { typeName: "ship", input: { orderId: 1 } },
      });
    }).toBeFunction();
  });

  it("rejects a continueWith blocker whose chain type the slot does not accept", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "report" },
        continueWith: {
          typeName: "summarize",
          input: null,
          // @ts-expect-error the first blocker slot only accepts "blocker"
          blockers: [{ id: "other-id", typeName: "other" }],
        },
      });
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "report" },
        continueWith: {
          typeName: "summarize",
          input: null,
          blockers: [{ id: "blocker-id", typeName: "blocker" }],
        },
      });
    }).toBeFunction();
  });

  it("types a continueWith blocker from another merged slice", () => {
    const reportJobTypes = defineJobTypes<
      {
        "merged-report": {
          entry: true;
          input: null;
          continueWith: { typeName: "merged-summarize" };
        };
        "merged-summarize": { input: null; output: null; blockers: [{ typeName: "blocker" }] };
      },
      { blocker: { entry: true; input: null; output: null } }
    >();

    expectTypeOf(
      async (client: InProcessClient<readonly [typeof jobTypes, typeof reportJobTypes]>) => {
        await client.applyJobOutcome({
          ...txCtx,
          job: { id: "id", typeName: "merged-report" },
          continueWith: {
            typeName: "merged-summarize",
            input: null,
            blockers: [{ id: "blocker-id", typeName: "blocker" }],
          },
        });
        await client.applyJobOutcome({
          ...txCtx,
          job: { id: "id", typeName: "merged-report" },
          continueWith: {
            typeName: "merged-summarize",
            input: null,
            // @ts-expect-error the blocker slot only accepts "blocker"
            blockers: [{ id: "other-id", typeName: "other" }],
          },
        });
      },
    ).toBeFunction();
  });

  it("rejects more than one outcome", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      // @ts-expect-error reason goes only with reschedule
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "ship" },
        output: { shipped: true },
        reason: "done",
      });
      // @ts-expect-error output and reschedule are separate outcomes
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "ship" },
        output: { shipped: true },
        reschedule: { afterMs: 0 },
      });
      // @ts-expect-error output and continueWith are separate outcomes
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "await-payment" },
        output: { paid: true },
        continueWith: { typeName: "ship", input: { orderId: "o-1" } },
      });
      // @ts-expect-error continueWith and reschedule are separate outcomes
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id", typeName: "await-payment" },
        continueWith: { typeName: "ship", input: { orderId: "o-1" } },
        reschedule: { afterMs: 0 },
      });
      await client.applyJobOutcome({
        ...txCtx,
        job: { id: "id" },
        reschedule: { afterMs: 0 },
        // @ts-expect-error output needs job.typeName, so only reschedule is accepted
        output: { shipped: true },
      });
    }).toBeFunction();
  });
});

describe("applyJobOutcomes", () => {
  const jobTypes = defineJobTypes<{
    "await-payment": {
      entry: true;
      input: { orderId: string };
      output: { paid: boolean };
      continueWith: { typeName: "ship" };
    };
    ship: { input: { orderId: string }; output: { shipped: boolean } };
    blocker: { entry: true; input: null; output: null };
  }>();
  type OutcomeClient = InProcessClient<typeof jobTypes>;

  it("returns a tuple for a const array of items, each typed by its outcome", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      const [paid, shipped, woken] = await client.applyJobOutcomes({
        ...txCtx,
        items: [
          { job: { id: "a", typeName: "await-payment" }, output: { paid: true } },
          {
            job: { id: "b", typeName: "await-payment" },
            continueWith: { typeName: "ship", input: { orderId: "o-1" } },
          },
          { job: { id: "c" }, reschedule: { afterMs: 0 } },
        ],
      });

      expectTypeOf(paid.output).toEqualTypeOf<{ paid: boolean }>();
      expectTypeOf(shipped.continuedTo.typeName).toEqualTypeOf<"ship">();
      expectTypeOf(woken.status).toEqualTypeOf<"blocked" | "pending">();
    }).toBeFunction();
  });

  it("checks each item against its own job type", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      await client.applyJobOutcomes({
        ...txCtx,
        items: [
          { job: { id: "a", typeName: "ship" }, output: { shipped: true } },
          // @ts-expect-error the output belongs to "ship", not "await-payment"
          { job: { id: "b", typeName: "await-payment" }, output: { shipped: true } },
        ],
      });
    }).toBeFunction();
  });

  it("rejects an item with more than one outcome", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      await client.applyJobOutcomes({
        ...txCtx,
        items: [
          // @ts-expect-error output and reschedule are separate outcomes
          {
            job: { id: "a", typeName: "ship" },
            output: { shipped: true },
            reschedule: { afterMs: 0 },
          },
        ],
      });
      await client.applyJobOutcomes({
        ...txCtx,
        items: [
          // @ts-expect-error output and continueWith are separate outcomes
          {
            job: { id: "b", typeName: "await-payment" },
            output: { paid: true },
            continueWith: { typeName: "ship", input: { orderId: "o-1" } },
          },
        ],
      });
    }).toBeFunction();
  });

  it("types a continueWith item of a job type without output, with a blocker from another merged slice", () => {
    const reportJobTypes = defineJobTypes<
      {
        report: { entry: true; input: null; continueWith: { typeName: "summarize" } };
        summarize: { input: null; output: null; blockers: [{ typeName: "blocker" }] };
      },
      { blocker: { entry: true; input: null; output: null } }
    >();

    expectTypeOf(
      async (client: InProcessClient<readonly [typeof jobTypes, typeof reportJobTypes]>) => {
        const [summarized] = await client.applyJobOutcomes({
          ...txCtx,
          items: [
            {
              job: { id: "a", typeName: "report" },
              continueWith: {
                typeName: "summarize",
                input: null,
                blockers: [{ id: "blocker-id", typeName: "blocker" }],
              },
            },
          ],
        });

        expectTypeOf(summarized.continuedTo.typeName).toEqualTypeOf<"summarize">();

        await client.applyJobOutcomes({
          ...txCtx,
          items: [
            {
              job: { id: "a", typeName: "report" },
              continueWith: {
                typeName: "summarize",
                input: null,
                // @ts-expect-error the blocker slot only accepts "blocker"
                blockers: [{ id: "other-id", typeName: "ship" }],
              },
            },
          ],
        });
      },
    ).toBeFunction();
  });

  it("accepts array literals in an item's output and continueWith input", () => {
    const listJobTypes = defineJobTypes<{
      collect: {
        entry: true;
        input: null;
        output: { list: string[] };
        continueWith: { typeName: "tag" };
      };
      tag: { input: { tags: string[]; nested: { ids: number[] } }; output: null };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof listJobTypes>) => {
      const [collected, tagged] = await client.applyJobOutcomes({
        ...txCtx,
        items: [
          { job: { id: "a", typeName: "collect" }, output: { list: ["x"] } },
          {
            job: { id: "b", typeName: "collect" },
            continueWith: { typeName: "tag", input: { tags: ["x"], nested: { ids: [1] } } },
          },
        ],
      });

      expectTypeOf(collected.output).toEqualTypeOf<{ list: string[] }>();
      expectTypeOf(tagged.continuedTo.typeName).toEqualTypeOf<"tag">();

      await client.applyJobOutcomes({
        ...txCtx,
        items: [
          {
            job: { id: "a", typeName: "collect" },
            // @ts-expect-error list holds strings
            output: { list: [1] },
          },
        ],
      });
    }).toBeFunction();
  });

  it("accepts reschedule items built from jobs read earlier", () => {
    expectTypeOf(async (client: OutcomeClient) => {
      const tails = await client.getChainTailJobs({
        ...txCtx,
        chainIds: ["a", "b"],
        lock: "exclusive",
      });
      const woken = await client.applyJobOutcomes({
        ...txCtx,
        items: tails.flatMap((job) =>
          job && (job.status === "pending" || job.status === "blocked")
            ? [{ job, reschedule: { afterMs: 0 } }]
            : [],
        ),
      });

      expectTypeOf(woken[0].status).toEqualTypeOf<"blocked" | "pending">();
    }).toBeFunction();
  });
});

describe("mode", () => {
  const jobTypes = defineJobTypes<{
    greet: { entry: true; input: { name: string }; output: { greeting: string } };
  }>();
  type SyncClient = ReturnType<typeof createClient<typeof jobTypes, InProcessStateAdapter>>;

  it("types state-touching methods as synchronous and awaitChain as async over a sync state adapter", () => {
    expectTypeOf<SyncClient["createChain"]>().returns.not.toExtend<Promise<unknown>>();
    expectTypeOf<SyncClient["getChains"]>().returns.not.toExtend<Promise<unknown>>();
    expectTypeOf<SyncClient["awaitChain"]>().returns.toExtend<Promise<unknown>>();
  });

  it("types state-touching methods as promises over an async state adapter", () => {
    expectTypeOf<InProcessClient<typeof jobTypes>["createChain"]>().returns.toExtend<
      Promise<unknown>
    >();
    expectTypeOf<InProcessClient<typeof jobTypes>["getChains"]>().returns.toExtend<
      Promise<unknown>
    >();
  });
});

describe("custom ID types", () => {
  const jobTypes = defineJobTypes<{ test: { entry: true; input: null; output: null } }>();
  type CustomIdClient = ReturnType<
    typeof createClient<
      typeof jobTypes,
      StateAdapter<{ db: string }, `job.${UUID}`, string, "async">
    >
  >;

  it("types chain and job IDs with the state adapter's job ID type", () => {
    expectTypeOf<
      Awaited<ReturnType<CustomIdClient["createChain"]>>["id"]
    >().toEqualTypeOf<`job.${UUID}`>();
    expectTypeOf<
      NonNullable<Awaited<ReturnType<CustomIdClient["getJob"]>>>["id"]
    >().toEqualTypeOf<`job.${UUID}`>();
  });
});
