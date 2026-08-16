import { describe, expectTypeOf, it } from "vitest";

import {
  type ContinuedJob,
  type OutputJob,
  type RescheduledJob,
} from "../entities/job-types.resolvers.js";
import { type InProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import {
  type AttemptFinish,
  type AttemptComplete,
  type AttemptCompleteCallback,
  type AttemptCompleteOptions,
  type AttemptHandler,
  type AttemptPrepare,
  type AttemptStep,
  type JobAbortReason,
} from "./job-process.types.js";

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

declare const prepare: AttemptPrepare<InProcessStateAdapter>;
declare const step: AttemptStep<InProcessStateAdapter>;
declare const complete: AttemptComplete<InProcessStateAdapter, LinearDefs, "entry", "entry">;

declare const linearCommit: AttemptFinish<InProcessStateAdapter, LinearDefs, "entry", "entry">;
declare const branchingCommit: AttemptFinish<InProcessStateAdapter, BranchingDefs, "root", "root">;
declare const sharedCommit: AttemptFinish<InProcessStateAdapter, SharedInputDefs, "root", "root">;
declare const terminalCommit: AttemptFinish<
  InProcessStateAdapter,
  TerminalDefs,
  "terminal",
  "terminal"
>;

const prepareBare = async () => prepare({ mode: "staged" });
const prepareWithCallback = async () => prepare({ mode: "atomic" }, () => 42);
const prepareWithAsyncCallback = async () => prepare({ mode: "staged" }, async () => "value");

describe("AttemptPrepare", () => {
  it("returns void when called without a callback", () => {
    expectTypeOf<Awaited<ReturnType<typeof prepareBare>>>().toBeVoid();
  });

  it("returns the awaited callback result when called with a callback", () => {
    expectTypeOf<Awaited<ReturnType<typeof prepareWithCallback>>>().toEqualTypeOf<number>();
  });

  it("unwraps a promise returned by the callback", () => {
    expectTypeOf<Awaited<ReturnType<typeof prepareWithAsyncCallback>>>().toEqualTypeOf<string>();
  });

  it("exposes the transaction context to the callback", () => {
    type CallbackOptions = Parameters<Parameters<typeof prepare<void>>[1]>[0];
    expectTypeOf<CallbackOptions>().toHaveProperty("tx");
  });

  it("rejects an unknown mode", () => {
    expectTypeOf(async () =>
      // @ts-expect-error mode is "atomic" | "staged"
      prepare({ mode: "eager" }),
    ).toBeFunction();
  });
});

const stepSync = async () => step(() => ({ done: true }));
const stepAsync = async () => step(async () => 7);

describe("AttemptStep", () => {
  it("returns the awaited callback result", () => {
    expectTypeOf<Awaited<ReturnType<typeof stepSync>>>().toEqualTypeOf<{ done: boolean }>();
  });

  it("unwraps a promise returned by the callback", () => {
    expectTypeOf<Awaited<ReturnType<typeof stepAsync>>>().toEqualTypeOf<number>();
  });

  it("exposes transactionHooks to the callback", () => {
    type CallbackOptions = Parameters<Parameters<typeof step<void>>[0]>[0];
    expectTypeOf<CallbackOptions>().toHaveProperty("transactionHooks");
  });
});

type LinearOutcome = Parameters<typeof linearCommit>[0];
type BranchingOutcome = Parameters<typeof branchingCommit>[0];
type SharedOutcome = Parameters<typeof sharedCommit>[0];
type TerminalOutcome = Parameters<typeof terminalCommit>[0];

const commitOutput = async () => terminalCommit({ output: { y: "done" } });
const commitContinue = async () =>
  linearCommit({ continueWith: { typeName: "step", input: { stepValue: true } } });

declare const branchBInput: { b: string };

describe("AttemptFinish", () => {
  describe("outcome parameter", () => {
    it("is a single parameter offering both discriminants", () => {
      expectTypeOf<{ output: { result: string } }>().toExtend<LinearOutcome>();
      expectTypeOf<{
        continueWith: { typeName: "step"; input: { stepValue: boolean } };
      }>().toExtend<LinearOutcome>();
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
      expectTypeOf<{
        continueWith:
          | { typeName: "branchA"; input: { a: number } }
          | { typeName: "branchB"; input: { b: string } };
      }>().toExtend<BranchingOutcome>();
    });

    it("accepts a union typeName when the continuations agree on input", () => {
      expectTypeOf<{
        continueWith: { typeName: "left" | "right"; input: { shared: number } };
      }>().toExtend<SharedOutcome>();
    });

    it("rejects a union typeName when the continuations disagree on input", () => {
      expectTypeOf<{
        continueWith: { typeName: "branchA" | "branchB"; input: { a: number } };
      }>().not.toExtend<BranchingOutcome>();
    });

    it("rejects a typeName that stays a union at the call site", () => {
      expectTypeOf(async (flag: boolean) =>
        branchingCommit({
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
        terminalCommit({ continueWith: { typeName: "terminal", input: { x: 1 } } }),
      ).toBeFunction();
    });

    it("rejects an output outcome on a job type with no output", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "root" declares no output
        branchingCommit({ output: { done: true } }),
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
        branchingCommit({ continueWith: { typeName: "branchA", input: { a: 1 } } });
      const commitBranchB = async () =>
        branchingCommit({ continueWith: { typeName: "branchB", input: { b: "x" } } });
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
        linearCommit({ continueWith: { typeName: "nope", input: { stepValue: true } } }),
      ).toBeFunction();
    });

    it("rejects a continuation input that does not match the target type", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "step" requires { stepValue: boolean }
        linearCommit({ continueWith: { typeName: "step", input: { a: 1 } } }),
      ).toBeFunction();
    });

    it("rejects a typeName paired with another continuation's input", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "branchA" requires { a: number }
        branchingCommit({ continueWith: { typeName: "branchA", input: branchBInput } }),
      ).toBeFunction();
    });

    it("rejects an output that does not match the job type", () => {
      expectTypeOf(async () =>
        // @ts-expect-error "terminal" outputs { y: string }
        terminalCommit({ output: { y: 123 } }),
      ).toBeFunction();
    });
  });
});

const completeContinuing = async () =>
  complete(async ({ finish }) =>
    finish({ continueWith: { typeName: "step", input: { stepValue: true } } }),
  );

describe("AttemptComplete", () => {
  it("passes the finish result through as its own return type", () => {
    expectTypeOf<Awaited<ReturnType<typeof completeContinuing>>>().toEqualTypeOf<
      Awaited<ReturnType<typeof commitContinue>>
    >();
  });

  it("leaves property access on the committed job unaffected", () => {
    type Result = Awaited<ReturnType<typeof completeContinuing>>;
    expectTypeOf<Result["status"]>().toEqualTypeOf<"completed">();
    expectTypeOf<Result["continuedTo"]["typeName"]>().toEqualTypeOf<"step">();
  });

  it("rejects a callback that returns something other than a job", () => {
    expectTypeOf(async () =>
      // @ts-expect-error the callback must return what finish handed back
      complete(async () => ({ status: "running" })),
    ).toBeFunction();
  });

  it("rejects a hand-built object that is not a whole completed job", () => {
    expectTypeOf(async () =>
      // @ts-expect-error a bare status literal is not a job
      complete(async () => ({ status: "completed" as const, continuedTo: undefined })),
    ).toBeFunction();
  });

  it("exposes finish and the transaction context to the callback", () => {
    type Options = AttemptCompleteOptions<InProcessStateAdapter, LinearDefs, "entry", "entry">;
    expectTypeOf<Options>().toHaveProperty("finish");
    expectTypeOf<Options>().toHaveProperty("transactionHooks");
    expectTypeOf<Options>().toHaveProperty("tx");
  });

  it("types the callback as receiving those options", () => {
    type Callback = AttemptCompleteCallback<
      InProcessStateAdapter,
      LinearDefs,
      "entry",
      "entry",
      never
    >;
    expectTypeOf<Parameters<Callback>[0]>().toEqualTypeOf<
      AttemptCompleteOptions<InProcessStateAdapter, LinearDefs, "entry", "entry">
    >();
  });
});

describe("AttemptHandler", () => {
  type Handler = AttemptHandler<
    InProcessStateAdapter,
    LinearDefs,
    "entry",
    "entry",
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
  type Options = Parameters<Handler>[0];

  it("narrows job.status to running", () => {
    expectTypeOf<Options["job"]["status"]>().toEqualTypeOf<"running">();
  });

  it("resolves job.input to the job type input", () => {
    expectTypeOf<Options["job"]["input"]>().toEqualTypeOf<{ value: number }>();
  });

  it("types the abort signal reasons", () => {
    expectTypeOf<Options["signal"]["reason"]>().toEqualTypeOf<JobAbortReason | undefined>();
  });

  it("exposes prepare, step and complete", () => {
    expectTypeOf<Options["prepare"]>().toEqualTypeOf<AttemptPrepare<InProcessStateAdapter>>();
    expectTypeOf<Options["step"]>().toEqualTypeOf<AttemptStep<InProcessStateAdapter>>();
    expectTypeOf<Options["complete"]>().toEqualTypeOf<
      AttemptComplete<InProcessStateAdapter, LinearDefs, "entry", "entry">
    >();
  });

  it("accepts what complete returned", () => {
    expectTypeOf<Awaited<ReturnType<typeof completeContinuing>>>().toExtend<
      Awaited<ReturnType<Handler>>
    >();
  });

  it("does not accept a running job", () => {
    expectTypeOf<Extract<Options["job"], { status: "running" }>>().not.toExtend<
      Awaited<ReturnType<Handler>>
    >();
  });

  it("accepts a rescheduled (pending) job", () => {
    expectTypeOf<RescheduledJob<string, LinearDefs, "entry", "entry">>().toExtend<
      Awaited<ReturnType<Handler>>
    >();
  });
});
