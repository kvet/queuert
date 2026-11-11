import { describe, expectTypeOf, it } from "vitest";

import type { AttemptMiddleware } from "../attempt-middleware/attempt-middleware.ts";
import type { createClient } from "../client.ts";
import type { CompletedChain } from "../entities/chain.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import type { JobTypes } from "../job-types/job-types.ts";
import type {
  InProcessContext,
  InProcessStateAdapter,
} from "../state-adapter/state-adapter.in-process.ts";
import type { GetStateAdapterTxContext } from "../state-adapter/state-adapter.ts";
import type { TxHooks } from "../tx-hooks/tx-hooks.ts";
import { createProcessors } from "./create-job-type-processors.ts";

type InProcessClient<TJobTypes extends JobTypes<any>> = ReturnType<
  typeof createClient<TJobTypes, InProcessStateAdapter>
>;

declare const txCtx: GetStateAdapterTxContext<InProcessStateAdapter>;
declare const txHooks: TxHooks;

describe("attempt handler job", () => {
  it("provides typed attempt information to the attempt handler", () => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();

    expectTypeOf((client: InProcessClient<typeof jobTypes>) =>
      createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf(job.attempt).toEqualTypeOf<number>();
              expectTypeOf(job.lastAttemptAt).toEqualTypeOf<Date | null>();
              expectTypeOf(job.lastAttemptError).toEqualTypeOf<string | null>();

              return complete({ ...txCtx, txHooks, output: null });
            },
          },
        },
      }),
    ).toBeFunction();
  });

  it("types the running job, the transaction context, the completed job and the chain", () => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { test: boolean }; output: { result: boolean } };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf(job.typeName).toEqualTypeOf<"test">();
              expectTypeOf(job.input).toEqualTypeOf<{ test: boolean }>();
              expectTypeOf(job.status).toEqualTypeOf<"running">();
              expectTypeOf(txCtx).toEqualTypeOf<InProcessContext>();

              const completedJob = await complete({ ...txCtx, txHooks, output: { result: true } });
              expectTypeOf(completedJob.typeName).toEqualTypeOf<"test">();
              expectTypeOf(completedJob.status).toEqualTypeOf<"completed">();
              if (completedJob.status === "completed") {
                expectTypeOf(completedJob.completedBy).toEqualTypeOf<string | null>();
              }
              return completedJob;
            },
          },
        },
      });

      const chain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "test",
        input: { test: true },
      });
      expectTypeOf<(typeof chain)["input"]>().toEqualTypeOf<{ test: boolean }>();
      expectTypeOf<(typeof chain)["typeName"]>().toEqualTypeOf<"test">();

      const completedChain = await client.awaitChain(chain, { timeoutMs: 0 });
      expectTypeOf(completedChain.status).toEqualTypeOf<"completed">();
      expectTypeOf(completedChain.output).toEqualTypeOf<{ result: boolean }>();
    }).toBeFunction();
  });

  it("types chainTypeName for jobs reachable from multiple chains", () => {
    const jobTypes = defineJobTypes<{
      entryA: { entry: true; input: { fromA: true }; continueWith: { typeName: "shared" } };
      entryB: { entry: true; input: { fromB: true }; continueWith: { typeName: "shared" } };
      shared: { input: { data: number }; output: { done: true } };
    }>();

    expectTypeOf((client: InProcessClient<typeof jobTypes>) =>
      createProcessors({
        client,
        jobTypes,
        processors: {
          entryA: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA">();
              return complete({
                ...txCtx,
                txHooks,
                continueWith: { typeName: "shared", input: { data: 1 } },
              });
            },
          },
          entryB: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryB">();
              return complete({
                ...txCtx,
                txHooks,
                continueWith: { typeName: "shared", input: { data: 2 } },
              });
            },
          },
          shared: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf(job.chainTypeName).toEqualTypeOf<"entryA" | "entryB">();
              return complete({ ...txCtx, txHooks, output: { done: true } });
            },
          },
        },
      }),
    ).toBeFunction();
  });

  it("types the blocker outputs of a single blocker slot", () => {
    const jobTypes = defineJobTypes<{
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

    expectTypeOf((client: InProcessClient<typeof jobTypes>) =>
      createProcessors({
        client,
        jobTypes,
        processors: {
          blocker: {
            attemptHandler: async ({ complete }) =>
              complete({ ...txCtx, txHooks, output: { done: true } }),
          },
          main: {
            attemptHandler: async ({
              job: {
                input,
                blockers: [blocker],
              },
              complete,
            }) => {
              expectTypeOf<(typeof blocker)["output"]>().toEqualTypeOf<{
                done: true;
              }>();

              return complete({
                ...txCtx,
                txHooks,
                output: {
                  finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
                },
              });
            },
          },
        },
      }),
    ).toBeFunction();
  });
});

describe("attempt middleware", () => {
  it("composes registry-level wrapHandler onion with typed ctx", () => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: { value: number }; output: null };
    }>();

    const traceMiddleware: AttemptMiddleware<any, { trace: string }> = {
      wrapHandler: async ({ next }) => next({ trace: "trace-1" }),
    };
    const auditMiddleware: AttemptMiddleware<any, { audit: string }> = {
      wrapHandler: async ({ next }) => next({ audit: "audit-1" }),
    };

    expectTypeOf((client: InProcessClient<typeof jobTypes>) =>
      createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [traceMiddleware, auditMiddleware],
        processors: {
          test: {
            attemptHandler: async ({ trace, audit, complete }) => {
              expectTypeOf(trace).toEqualTypeOf<string>();
              expectTypeOf(audit).toEqualTypeOf<string>();
              return complete({ ...txCtx, txHooks, output: null });
            },
          },
        },
      }),
    ).toBeFunction();
  });
});

describe("continueWith", () => {
  it("types chained jobs", () => {
    const jobTypes = defineJobTypes<{
      linear: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "linear_next" };
      };
      linear_next: {
        input: { valueNext: number };
        continueWith: { typeName: "linear_next_next" };
      };
      linear_next_next: {
        input: { valueNextNext: number };
        output: { result: number };
      };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      createProcessors({
        client,
        jobTypes,
        processors: {
          linear: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf<
                Extract<
                  Parameters<typeof complete>[0],
                  { continueWith: unknown }
                >["continueWith"]["typeName"]
              >().toEqualTypeOf<"linear_next">();

              const completedJob = await complete({
                ...txCtx,
                txHooks,
                continueWith: {
                  typeName: "linear_next",
                  input: { valueNext: job.input.value + 1 },
                },
              });
              expectTypeOf(completedJob.continuedTo.typeName).toEqualTypeOf<"linear_next">();
              expectTypeOf(completedJob.continuedTo.status).toEqualTypeOf<"pending">();
              return completedJob;
            },
          },
          linear_next: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf<
                Extract<
                  Parameters<typeof complete>[0],
                  { continueWith: unknown }
                >["continueWith"]["typeName"]
              >().toEqualTypeOf<"linear_next_next">();

              const completedJob = await complete({
                ...txCtx,
                txHooks,
                continueWith: {
                  typeName: "linear_next_next",
                  input: { valueNextNext: job.input.valueNext + 1 },
                },
              });
              expectTypeOf(completedJob.continuedTo.typeName).toEqualTypeOf<"linear_next_next">();
              expectTypeOf(completedJob.continuedTo.status).toEqualTypeOf<"pending">();
              return completedJob;
            },
          },
          linear_next_next: {
            attemptHandler: async ({ job, complete }) => {
              const result = await complete({
                ...txCtx,
                txHooks,
                output: { result: job.input.valueNextNext },
              });
              expectTypeOf(result.typeName).toEqualTypeOf<"linear_next_next">();
              expectTypeOf(result.status).toEqualTypeOf<"completed">();
              return result;
            },
          },
        },
      });

      const chain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "linear",
        input: { value: 1 },
      });
      expectTypeOf(chain.input).toEqualTypeOf<{ value: number }>();
      expectTypeOf<CompletedChain<typeof chain>["output"]>().toEqualTypeOf<{
        result: number;
      }>();
      expectTypeOf<
        Parameters<(typeof client)["createChain"]>[0]["typeName"]
      >().toEqualTypeOf<"linear">();
      expectTypeOf<Parameters<(typeof client)["getChain"]>[0]["typeName"]>().toEqualTypeOf<
        "linear" | undefined
      >();

      const finishedChain = await client.awaitChain(chain, { timeoutMs: 0 });
      expectTypeOf(finishedChain.output).toEqualTypeOf<{
        result: number;
      }>();
    }).toBeFunction();
  });

  it("types branched chains", () => {
    const jobTypes = defineJobTypes<{
      main: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "branch1" | "branch2" };
      };
      branch1: {
        input: { valueBranched: number };
        output: { result1: number };
      };
      branch2: {
        input: { valueBranched: number };
        output: { result2: number };
      };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      createProcessors({
        client,
        jobTypes,
        processors: {
          main: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf<
                Extract<
                  Parameters<typeof complete>[0],
                  { continueWith: unknown }
                >["continueWith"]["typeName"]
              >().toEqualTypeOf<"branch1" | "branch2">();

              return complete({
                ...txCtx,
                txHooks,
                continueWith: {
                  typeName: job.input.value % 2 === 0 ? "branch1" : "branch2",
                  input: { valueBranched: job.input.value },
                },
              });
            },
          },
        },
      });

      const evenChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: { value: 2 },
      });
      const oddChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: { value: 3 },
      });
      expectTypeOf<CompletedChain<typeof evenChain>["output"]>().toEqualTypeOf<
        { result1: number } | { result2: number }
      >();
      expectTypeOf<CompletedChain<typeof oddChain>["output"]>().toEqualTypeOf<
        { result1: number } | { result2: number }
      >();

      const succeededChains = await Promise.all([
        client.awaitChain(evenChain, { timeoutMs: 0 }),
        client.awaitChain(oddChain, { timeoutMs: 0 }),
      ]);
      expectTypeOf(succeededChains[0].output).toEqualTypeOf<
        { result1: number } | { result2: number }
      >();
      expectTypeOf(succeededChains[1].output).toEqualTypeOf<
        { result1: number } | { result2: number }
      >();
    }).toBeFunction();
  });

  it("types branched chains with different inputs", () => {
    const jobTypes = defineJobTypes<{
      main: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "branch1" | "branch2" };
      };
      branch1: {
        input: { valueBranched1: number };
        output: { result: number };
      };
      branch2: {
        input: { valueBranched2: number };
        output: { result: number };
      };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      createProcessors({
        client,
        jobTypes,
        processors: {
          main: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf<
                Extract<
                  Parameters<typeof complete>[0],
                  { continueWith: unknown }
                >["continueWith"]["typeName"]
              >().toEqualTypeOf<"branch1" | "branch2">();

              const badInput = { valueBranched2: job.input.value };
              void complete({
                ...txCtx,
                txHooks,
                // @ts-expect-error typeName/input mismatch must be rejected
                continueWith: { typeName: "branch1", input: badInput },
              });

              return complete({
                ...txCtx,
                txHooks,
                continueWith: {
                  typeName: "branch1",
                  input: { valueBranched1: job.input.value },
                },
              });
            },
          },
        },
      });

      const evenChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: { value: 2 },
      });
      const oddChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: { value: 3 },
      });
      expectTypeOf<CompletedChain<typeof evenChain>["output"]>().toEqualTypeOf<{
        result: number;
      }>();
      expectTypeOf<CompletedChain<typeof oddChain>["output"]>().toEqualTypeOf<{
        result: number;
      }>();

      const succeededChains = await Promise.all([
        client.awaitChain(evenChain, { timeoutMs: 0 }),
        client.awaitChain(oddChain, { timeoutMs: 0 }),
      ]);
      expectTypeOf(succeededChains[0].output).toEqualTypeOf<{ result: number }>();
      expectTypeOf(succeededChains[1].output).toEqualTypeOf<{ result: number }>();
    }).toBeFunction();
  });

  it("types loops", () => {
    const jobTypes = defineJobTypes<{
      loop: {
        entry: true;
        input: { counter: number };
        output: { done: true };
        continueWith: { typeName: "loop" };
      };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      createProcessors({
        client,
        jobTypes,
        processors: {
          loop: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf<
                Extract<
                  Parameters<typeof complete>[0],
                  { continueWith: unknown }
                >["continueWith"]["typeName"]
              >().toEqualTypeOf<"loop">();

              return job.input.counter < 3
                ? complete({
                    ...txCtx,
                    txHooks,
                    continueWith: { typeName: "loop", input: { counter: job.input.counter + 1 } },
                  })
                : complete({ ...txCtx, txHooks, output: { done: true } });
            },
          },
        },
      });

      const chain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "loop",
        input: { counter: 0 },
      });
      expectTypeOf<CompletedChain<typeof chain>["output"]>().toEqualTypeOf<{
        done: true;
      }>();
    }).toBeFunction();
  });

  it("types go-to", () => {
    const jobTypes = defineJobTypes<{
      start: {
        entry: true;
        input: { value: number };
        continueWith: { typeName: "end" };
      };
      end: {
        input: { result: number };
        output: { finalResult: number };
        continueWith: { typeName: "start" };
      };
    }>();

    expectTypeOf(async (client: InProcessClient<typeof jobTypes>) => {
      createProcessors({
        client,
        jobTypes,
        processors: {
          start: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf<
                Extract<
                  Parameters<typeof complete>[0],
                  { continueWith: unknown }
                >["continueWith"]["typeName"]
              >().toEqualTypeOf<"end">();

              return complete({
                ...txCtx,
                txHooks,
                continueWith: { typeName: "end", input: { result: job.input.value + 1 } },
              });
            },
          },
          end: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf<
                Extract<
                  Parameters<typeof complete>[0],
                  { continueWith: unknown }
                >["continueWith"]["typeName"]
              >().toEqualTypeOf<"start">();

              return complete({ ...txCtx, txHooks, output: { finalResult: job.input.result } });
            },
          },
        },
      });

      const chain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "start",
        input: { value: 0 },
      });
      expectTypeOf<CompletedChain<typeof chain>["output"]>().toEqualTypeOf<{
        finalResult: number;
      }>();

      const succeededChain = await client.awaitChain(chain, { timeoutMs: 0 });
      expectTypeOf(succeededChain.output).toEqualTypeOf<{
        finalResult: number;
      }>();
    }).toBeFunction();
  });
});
