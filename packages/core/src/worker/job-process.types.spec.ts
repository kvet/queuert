import { describe, expectTypeOf, it } from "vitest";

import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import {
  type CompletedBlockerChains,
  type ContinuedJob,
  type OutputJob,
  type RescheduledJob,
} from "../entities/job-types.resolvers.js";
import {
  type InProcessContext,
  type InProcessStateAdapter,
} from "../state-adapter/state-adapter.in-process.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import {
  type AttemptFinish as AttemptFinishType,
  type AttemptGetBlockers as AttemptGetBlockersType,
  type AttemptHandler as AttemptHandlerType,
  type JobAbortReason,
} from "./job-process.types.js";

// The exported types constrain the adapter to `StateAdapter<BaseTxContext, any>`, which an
// adapter with required transaction fields (like the in-process one) does not satisfy when
// named directly. Real call sites reach these types through `StateAdapter<any, any>`-constrained
// generics (`createProcessors`, `InProcessWorkerProcessor`); these aliases do the same.
type AttemptFinish<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
> = AttemptFinishType<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName>;
type AttemptGetBlockers<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> = AttemptGetBlockersType<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
type AttemptHandler<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  THandlerCtx,
> = AttemptHandlerType<
  TStateAdapter,
  TJobTypeDefinitions,
  TJobTypeName,
  TChainTypeName,
  THandlerCtx
>;

type LinearDefs = {
  entry: {
    entry: true;
    input: { value: number };
    output: { result: string };
    continueWith: { typeName: "step" };
  };
  step: {
    input: { stepValue: boolean };
    output: { stepResult: number };
  };
};

type BranchingDefs = {
  root: {
    entry: true;
    input: null;
    continueWith: { typeName: "branchA" | "branchB" };
  };
  branchA: {
    input: { a: number };
    output: { resultA: string };
  };
  branchB: {
    input: { b: string };
    output: { resultB: boolean };
  };
};

type SharedInputDefs = {
  root: {
    entry: true;
    input: null;
    continueWith: { typeName: "left" | "right" };
  };
  left: {
    input: { shared: number };
    output: { l: true };
  };
  right: {
    input: { shared: number };
    output: { r: true };
  };
};

type TerminalDefs = {
  terminal: {
    entry: true;
    input: { x: number };
    output: { y: string };
  };
};

type BlockerDefs = {
  blocker: {
    entry: true;
    input: { id: string };
    output: { fetched: number };
  };
  main: {
    entry: true;
    input: null;
    output: { total: number };
    blockers: [{ typeName: "blocker" }];
  };
};

declare const tx: Required<InProcessContext> & { transactionHooks: TransactionHooks };
declare const txCtx: Required<InProcessContext>;
declare const transactionHooks: TransactionHooks;
type Tx = typeof tx;

declare const linearCommit: AttemptFinish<InProcessStateAdapter, LinearDefs, "entry", "entry">;
declare const branchingCommit: AttemptFinish<InProcessStateAdapter, BranchingDefs, "root", "root">;
declare const sharedCommit: AttemptFinish<InProcessStateAdapter, SharedInputDefs, "root", "root">;
declare const terminalCommit: AttemptFinish<
  InProcessStateAdapter,
  TerminalDefs,
  "terminal",
  "terminal"
>;

type LinearOutcome = Parameters<typeof linearCommit>[0];
type BranchingOutcome = Parameters<typeof branchingCommit>[0];
type SharedOutcome = Parameters<typeof sharedCommit>[0];
type TerminalOutcome = Parameters<typeof terminalCommit>[0];

const commitOutput = async () => terminalCommit({ ...tx, output: { y: "done" } });
const commitContinue = async () =>
  linearCommit({ ...tx, continueWith: { typeName: "step", input: { stepValue: true } } });

declare const branchBInput: { b: string };

describe("AttemptFinish", () => {
  describe("outcome parameter", () => {
    it("is a single parameter offering both discriminants", () => {
      expectTypeOf<{ output: { result: string } } & Tx>().toExtend<LinearOutcome>();
      expectTypeOf<
        {
          continueWith: { typeName: "step"; input: { stepValue: boolean } };
        } & Tx
      >().toExtend<LinearOutcome>();
    });

    it("keeps one entry per continuation so typeName narrows input", () => {
      type Entry = Extract<BranchingOutcome, { continueWith: unknown }>["continueWith"];
      expectTypeOf<Extract<Entry, { typeName: "branchA" }>["input"]>().toEqualTypeOf<{
        a: number;
      }>();
      expectTypeOf<Extract<Entry, { typeName: "branchB" }>["input"]>().toEqualTypeOf<{
        b: string;
      }>();
    });

    it("exposes every continuation type name", () => {
      expectTypeOf<
        Extract<BranchingOutcome, { continueWith: unknown }>["continueWith"]["typeName"]
      >().toEqualTypeOf<"branchA" | "branchB">();
    });
  });

  describe("transaction requirement", () => {
    it("accepts the transaction context and transactionHooks spread alongside the outcome", () => {
      expectTypeOf(async () =>
        terminalCommit({ ...txCtx, transactionHooks, output: { y: "done" } }),
      ).toBeFunction();
    });

    it("rejects a call without the transaction context", () => {
      expectTypeOf(async () =>
        // @ts-expect-error finish must run inside the caller's transaction
        terminalCommit({ transactionHooks, output: { y: "done" } }),
      ).toBeFunction();
    });

    it("rejects a partial transaction context even when the adapter's fields are optional", () => {
      const partialTxCtx: Partial<InProcessContext> = {};
      expectTypeOf(async () =>
        // @ts-expect-error every field of the transaction context is required
        terminalCommit({ ...partialTxCtx, transactionHooks, output: { y: "done" } }),
      ).toBeFunction();
    });

    it("rejects a call without transactionHooks", () => {
      expectTypeOf(async () =>
        // @ts-expect-error finish buffers its events in the caller's transactionHooks
        terminalCommit({ ...txCtx, output: { y: "done" } }),
      ).toBeFunction();
    });
  });

  describe("continueWith entry", () => {
    type Entry = Extract<LinearOutcome, { continueWith: unknown }>["continueWith"];

    it("requires the correct input for the specified continuation type", () => {
      expectTypeOf<Entry["typeName"]>().toEqualTypeOf<"step">();
      expectTypeOf<Entry["input"]>().toEqualTypeOf<{ stepValue: boolean }>();
    });

    it("forbids blockers for a continuation type that declares none", () => {
      expectTypeOf<Entry["blockers"]>().toEqualTypeOf<undefined>();
    });

    it("keeps id and schedule optional", () => {
      expectTypeOf<Entry>().toHaveProperty("id");
      expectTypeOf<Entry>().toHaveProperty("schedule");
      expectTypeOf<{ typeName: "step"; input: { stepValue: boolean } }>().toExtend<Entry>();
    });
  });

  describe("computed continuations", () => {
    it("accepts a computed continueWith value spanning several continuations", () => {
      expectTypeOf<
        {
          continueWith:
            | { typeName: "branchA"; input: { a: number } }
            | { typeName: "branchB"; input: { b: string } };
        } & Tx
      >().toExtend<BranchingOutcome>();
    });

    it("accepts a union typeName when the continuations agree on input", () => {
      expectTypeOf<
        {
          continueWith: { typeName: "left" | "right"; input: { shared: number } };
        } & Tx
      >().toExtend<SharedOutcome>();
    });

    it("rejects a union typeName when the continuations disagree on input", () => {
      expectTypeOf<
        {
          continueWith: { typeName: "branchA" | "branchB"; input: { a: number } };
        } & Tx
      >().not.toExtend<BranchingOutcome>();
    });

    it("rejects a typeName that stays a union at the call site", () => {
      expectTypeOf(async (flag: boolean) =>
        branchingCommit({
          ...tx,
          // @ts-expect-error typeName must resolve to a single continuation
          continueWith: { typeName: flag ? "branchA" : "branchB", input: { a: 1 } },
        }),
      ).toBeFunction();
    });
  });

  describe("job types missing an outcome kind", () => {
    it("keeps both kinds when the job type declares both", () => {
      expectTypeOf<Extract<LinearOutcome, { output: unknown }>>().not.toBeNever();
      expectTypeOf<Extract<LinearOutcome, { continueWith: unknown }>>().not.toBeNever();
    });

    it("exposes no continueWith key at all for a terminal job type", () => {
      expectTypeOf<Extract<TerminalOutcome, { continueWith: unknown }>>().toBeNever();
      expectTypeOf<Extract<TerminalOutcome, { output: unknown }>>().not.toBeNever();
      expectTypeOf<Extract<TerminalOutcome, { reschedule: unknown }>>().not.toBeNever();
    });

    it("exposes no output key at all for a job type with no output", () => {
      expectTypeOf<Extract<BranchingOutcome, { output: unknown }>>().toBeNever();
      expectTypeOf<Extract<BranchingOutcome, { continueWith: unknown }>>().not.toBeNever();
      expectTypeOf<Extract<BranchingOutcome, { reschedule: unknown }>>().not.toBeNever();
    });

    it("rejects a continueWith outcome on a terminal job type", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "terminal" declares no continuation
        terminalCommit({ ...tx, continueWith: { typeName: "terminal", input: { x: 1 } } }),
      ).toBeFunction();
    });

    it("rejects an output outcome on a job type with no output", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "root" declares no output
        branchingCommit({ ...tx, output: { done: true } }),
      ).toBeFunction();
    });
  });

  describe("committed result", () => {
    type OutputResult = Awaited<ReturnType<typeof commitOutput>>;
    type ContinuedResult = Awaited<ReturnType<typeof commitContinue>>;

    it("resolves an output outcome to the completed job", () => {
      expectTypeOf<OutputResult>().toExtend<
        OutputJob<string, TerminalDefs, "terminal", "terminal">
      >();
      expectTypeOf<OutputResult["status"]>().toEqualTypeOf<"completed">();
      expectTypeOf<OutputResult["continuedTo"]>().toEqualTypeOf<undefined>();
    });

    it("resolves a continueWith outcome to the continued job", () => {
      expectTypeOf<ContinuedResult>().toExtend<
        ContinuedJob<string, LinearDefs, "entry", "entry", "step">
      >();
      expectTypeOf<ContinuedResult["continuedTo"]["typeName"]>().toEqualTypeOf<"step">();
      expectTypeOf<ContinuedResult["continuedTo"]["input"]>().toEqualTypeOf<{
        stepValue: boolean;
      }>();
    });

    it("narrows the continued job per branch", () => {
      const commitBranchA = async () =>
        branchingCommit({ ...tx, continueWith: { typeName: "branchA", input: { a: 1 } } });
      const commitBranchB = async () =>
        branchingCommit({ ...tx, continueWith: { typeName: "branchB", input: { b: "x" } } });
      expectTypeOf<
        Awaited<ReturnType<typeof commitBranchA>>["continuedTo"]["input"]
      >().toEqualTypeOf<{ a: number }>();
      expectTypeOf<
        Awaited<ReturnType<typeof commitBranchB>>["continuedTo"]["input"]
      >().toEqualTypeOf<{ b: string }>();
    });
  });

  describe("rejections", () => {
    it("rejects an unknown continuation type name", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "nope" is not a continuation of "entry"
        linearCommit({ ...tx, continueWith: { typeName: "nope", input: { stepValue: true } } }),
      ).toBeFunction();
    });

    it("rejects a continuation input that does not match the target type", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "step" requires { stepValue: boolean }
        linearCommit({ ...tx, continueWith: { typeName: "step", input: { a: 1 } } }),
      ).toBeFunction();
    });

    it("rejects a typeName paired with another continuation's input", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "branchA" requires { a: number }
        branchingCommit({ ...tx, continueWith: { typeName: "branchA", input: branchBInput } }),
      ).toBeFunction();
    });

    it("rejects an output that does not match the job type", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "terminal" outputs { y: string }
        terminalCommit({ ...tx, output: { y: 123 } }),
      ).toBeFunction();
    });
  });
});

declare const getBlockers: AttemptGetBlockers<InProcessStateAdapter, BlockerDefs, "main">;

describe("AttemptGetBlockers", () => {
  type Blockers = Awaited<ReturnType<typeof getBlockers>>;

  it("resolves to the completed blocker chains in declaration order", () => {
    expectTypeOf<Blockers>().toEqualTypeOf<CompletedBlockerChains<string, BlockerDefs, "main">>();
    expectTypeOf<Blockers[0]["typeName"]>().toEqualTypeOf<"blocker">();
    expectTypeOf<Blockers[0]["status"]>().toEqualTypeOf<"completed">();
    expectTypeOf<Blockers[0]["output"]>().toEqualTypeOf<{ fetched: number }>();
  });

  it("takes an optional transaction context", () => {
    expectTypeOf(async () => getBlockers()).toBeFunction();
    expectTypeOf(async () => getBlockers(txCtx)).toBeFunction();
    expectTypeOf(async () => getBlockers({})).toBeFunction();
  });
});

describe("AttemptHandler", () => {
  type Handler = AttemptHandler<InProcessStateAdapter, LinearDefs, "entry", "entry", unknown>;
  type Options = Parameters<Handler>[0];

  type BlockedHandler = AttemptHandler<InProcessStateAdapter, BlockerDefs, "main", "main", unknown>;
  type BlockedOptions = Parameters<BlockedHandler>[0];

  it("narrows job.status to running", () => {
    expectTypeOf<Options["job"]["status"]>().toEqualTypeOf<"running">();
  });

  it("resolves job.input to the job type input", () => {
    expectTypeOf<Options["job"]["input"]>().toEqualTypeOf<{ value: number }>();
  });

  it("types the abort signal reasons", () => {
    expectTypeOf<Options["signal"]["reason"]>().toEqualTypeOf<JobAbortReason | undefined>();
  });

  it("exposes finish", () => {
    expectTypeOf<Options["finish"]>().toEqualTypeOf<
      AttemptFinish<InProcessStateAdapter, LinearDefs, "entry", "entry">
    >();
  });

  it("exposes only signal, job, finish and getBlockers, and no job.blockers", () => {
    expectTypeOf<keyof Options>().toEqualTypeOf<"signal" | "job" | "finish" | "getBlockers">();
    expectTypeOf<keyof BlockedOptions>().toEqualTypeOf<
      "signal" | "job" | "finish" | "getBlockers"
    >();
    expectTypeOf<"blockers" extends keyof Options["job"] ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<
      "blockers" extends keyof BlockedOptions["job"] ? true : false
    >().toEqualTypeOf<false>();
  });

  it("exposes getBlockers only for job types that declare blockers", () => {
    expectTypeOf<BlockedOptions["getBlockers"]>().toEqualTypeOf<
      AttemptGetBlockers<InProcessStateAdapter, BlockerDefs, "main">
    >();
    expectTypeOf<Options["getBlockers"]>().toEqualTypeOf<undefined>();
  });

  it("accepts a handler that returns what finish returned", () => {
    const handler: Handler = async ({ finish }) =>
      finish({ ...tx, continueWith: { typeName: "step", input: { stepValue: true } } });
    expectTypeOf(handler).toBeFunction();
    expectTypeOf<Awaited<ReturnType<typeof commitContinue>>>().toExtend<
      Awaited<ReturnType<Handler>>
    >();
  });

  it("accepts a rescheduled (pending) job", () => {
    expectTypeOf<RescheduledJob<string, LinearDefs, "entry", "entry">>().toExtend<
      Awaited<ReturnType<Handler>>
    >();
  });

  it("rejects a handler that does not return the finish result", () => {
    // @ts-expect-error the handler must return what finish returned
    const missing: Handler = async ({ finish }) => {
      await finish({ ...tx, output: { result: "x" } });
    };
    expectTypeOf(missing).toBeFunction();
  });

  it("does not accept a running job", () => {
    expectTypeOf<Extract<Options["job"], { status: "running" }>>().not.toExtend<
      Awaited<ReturnType<Handler>>
    >();
  });

  it("rejects a hand-built object that is not a whole completed job", () => {
    // @ts-expect-error a bare status literal is not a job
    const handBuilt: Handler = async () => ({
      status: "completed" as const,
      continuedTo: undefined,
    });
    expectTypeOf(handBuilt).toBeFunction();
  });

  it("merges the middleware ctx into the handler options", () => {
    type CtxHandler = AttemptHandler<
      InProcessStateAdapter,
      LinearDefs,
      "entry",
      "entry",
      { traceId: string }
    >;
    expectTypeOf<Parameters<CtxHandler>[0]["traceId"]>().toEqualTypeOf<string>();
  });
});

describe("AttemptFinish variance", () => {
  it("is invariant in the definitions and job type name", () => {
    expectTypeOf<AttemptFinish<InProcessStateAdapter, LinearDefs, "entry", "entry">>().not.toExtend<
      AttemptFinish<InProcessStateAdapter, LinearDefs, "step", "entry">
    >();
    expectTypeOf<AttemptFinish<InProcessStateAdapter, LinearDefs, "entry", "entry">>().not.toExtend<
      AttemptFinish<InProcessStateAdapter, BranchingDefs, "root", "entry">
    >();
  });

  it("is covariant in the chain type name", () => {
    expectTypeOf<AttemptFinish<InProcessStateAdapter, LinearDefs, "entry", "entry">>().toExtend<
      AttemptFinish<InProcessStateAdapter, LinearDefs, "entry", string>
    >();
    expectTypeOf<AttemptFinish<InProcessStateAdapter, LinearDefs, "entry", string>>().not.toExtend<
      AttemptFinish<InProcessStateAdapter, LinearDefs, "entry", "entry">
    >();
  });
});
