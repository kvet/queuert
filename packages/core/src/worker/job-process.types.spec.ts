import { describe, expectTypeOf, it } from "vitest";

import {
  type CompletedBlockerChains,
  type ContinuedJob,
  type OutputJob,
  type RescheduledJob,
} from "../job-types/job-types.resolvers.js";
import { type InProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type AttemptComplete, type AttemptHandler } from "./job-process.types.js";

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

// A transaction context with a required field, as real database adapters have.
type ClientContext = { client: { query: (sql: string) => Promise<unknown> } };
type ClientStateAdapter = StateAdapter<ClientContext, string>;

declare const txCtx: ClientContext;
declare const transactionHooks: TransactionHooks;
declare const tx: ClientContext & { transactionHooks: TransactionHooks };
type Tx = typeof tx;

declare const linearCommit: AttemptComplete<ClientStateAdapter, LinearDefs, "entry", "entry">;
declare const branchingCommit: AttemptComplete<ClientStateAdapter, BranchingDefs, "root", "root">;
declare const sharedCommit: AttemptComplete<ClientStateAdapter, SharedInputDefs, "root", "root">;
declare const terminalCommit: AttemptComplete<
  ClientStateAdapter,
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

describe("AttemptComplete", () => {
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
        // @ts-expect-error complete must run inside the caller's transaction
        terminalCommit({ transactionHooks, output: { y: "done" } }),
      ).toBeFunction();
    });

    it("rejects a call without transactionHooks", () => {
      expectTypeOf(async () =>
        // @ts-expect-error complete buffers its events in the caller's transactionHooks
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

  it("exposes complete", () => {
    expectTypeOf<Options["complete"]>().toEqualTypeOf<
      AttemptComplete<InProcessStateAdapter, LinearDefs, "entry", "entry">
    >();
  });

  it("exposes only signal, job and complete", () => {
    expectTypeOf<keyof Options>().toEqualTypeOf<"signal" | "job" | "complete">();
    expectTypeOf<keyof BlockedOptions>().toEqualTypeOf<"signal" | "job" | "complete">();
  });

  it("resolves job.blockers to the completed blocker chains in declaration order", () => {
    type Blockers = BlockedOptions["job"]["blockers"];
    expectTypeOf<Blockers>().toEqualTypeOf<CompletedBlockerChains<string, BlockerDefs, "main">>();
    expectTypeOf<Blockers[0]["typeName"]>().toEqualTypeOf<"blocker">();
    expectTypeOf<Blockers[0]["status"]>().toEqualTypeOf<"completed">();
    expectTypeOf<Blockers[0]["output"]>().toEqualTypeOf<{ fetched: number }>();
    expectTypeOf<Options["job"]["blockers"]>().toEqualTypeOf<[]>();
  });

  it("accepts a handler that returns what complete returned", () => {
    const handler: Handler = async ({ complete }) =>
      complete({ ...tx, continueWith: { typeName: "step", input: { stepValue: true } } });
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

  it("rejects a handler that does not return the `complete` result", () => {
    // @ts-expect-error the handler must return what complete returned
    const missing: Handler = async ({ complete }) => {
      await complete({ ...tx, output: { result: "x" } });
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

describe("AttemptComplete variance", () => {
  it("is invariant in the definitions and job type name", () => {
    expectTypeOf<
      AttemptComplete<InProcessStateAdapter, LinearDefs, "entry", "entry">
    >().not.toExtend<AttemptComplete<InProcessStateAdapter, LinearDefs, "step", "entry">>();
    expectTypeOf<
      AttemptComplete<InProcessStateAdapter, LinearDefs, "entry", "entry">
    >().not.toExtend<AttemptComplete<InProcessStateAdapter, BranchingDefs, "root", "entry">>();
  });

  it("is covariant in the chain type name", () => {
    expectTypeOf<AttemptComplete<InProcessStateAdapter, LinearDefs, "entry", "entry">>().toExtend<
      AttemptComplete<InProcessStateAdapter, LinearDefs, "entry", string>
    >();
    expectTypeOf<
      AttemptComplete<InProcessStateAdapter, LinearDefs, "entry", string>
    >().not.toExtend<AttemptComplete<InProcessStateAdapter, LinearDefs, "entry", "entry">>();
  });
});
