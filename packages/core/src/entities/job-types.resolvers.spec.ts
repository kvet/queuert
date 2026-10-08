import { describe, expectTypeOf, it } from "vitest";

import {
  type BlockerChains,
  type CompletedBlockerChains,
  type ContinuationJob,
  type ContinuedJob,
  type JobTypeReachingEntry,
  type OutputJob,
  type RescheduledJob,
  type ResolvedChain,
  type ResolvedCompletedChain,
  type ResolvedJob,
  type ResolvedRunningChain,
  type ResolvedRunningJob,
} from "./job-types.resolvers.js";

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

describe("OutputJob", () => {
  type Result = OutputJob<string, LinearDefs, "entry">;

  it("resolves status to completed", () => {
    expectTypeOf<Result["status"]>().toEqualTypeOf<"completed">();
  });

  it("resolves continuedTo to undefined", () => {
    expectTypeOf<Result["continuedTo"]>().toEqualTypeOf<undefined>();
  });

  it("preserves the job type name", () => {
    expectTypeOf<Result["typeName"]>().toEqualTypeOf<"entry">();
  });

  it("preserves the input type", () => {
    expectTypeOf<Result["input"]>().toEqualTypeOf<{ value: number }>();
  });
});

describe("ContinuedJob", () => {
  type Result = ContinuedJob<string, LinearDefs, "entry", "entry", "step">;

  it("resolves status to completed", () => {
    expectTypeOf<Result["status"]>().toEqualTypeOf<"completed">();
  });

  it("narrows continuedTo to the specific continuation job type", () => {
    expectTypeOf<Result["continuedTo"]>().toEqualTypeOf<
      ContinuationJob<string, LinearDefs, "step", "entry">
    >();
  });

  it("resolves continuedTo.typeName to the continuation type name", () => {
    expectTypeOf<Result["continuedTo"]["typeName"]>().toEqualTypeOf<"step">();
  });

  it("resolves continuedTo.status to pending", () => {
    expectTypeOf<Result["continuedTo"]["status"]>().toEqualTypeOf<"pending">();
  });

  it("resolves continuedTo.input to the continuation input type", () => {
    expectTypeOf<Result["continuedTo"]["input"]>().toEqualTypeOf<{ stepValue: boolean }>();
  });
});

describe("ContinuedJob branching", () => {
  it("narrows to branchA when TContinuationTypeName is branchA", () => {
    type Result = ContinuedJob<string, BranchingDefs, "root", "root", "branchA">;
    expectTypeOf<Result["continuedTo"]["typeName"]>().toEqualTypeOf<"branchA">();
    expectTypeOf<Result["continuedTo"]["input"]>().toEqualTypeOf<{ a: number }>();
  });

  it("narrows to branchB when TContinuationTypeName is branchB", () => {
    type Result = ContinuedJob<string, BranchingDefs, "root", "root", "branchB">;
    expectTypeOf<Result["continuedTo"]["typeName"]>().toEqualTypeOf<"branchB">();
    expectTypeOf<Result["continuedTo"]["input"]>().toEqualTypeOf<{ b: string }>();
  });
});

type TerminalOnlyDefs = {
  only: { entry: true; input: { x: number }; output: { y: string } };
};

type ContinuingOnlyDefs = {
  head: { entry: true; input: { h: 1 }; continueWith: { typeName: "tail" } };
  tail: { input: { t: 1 }; output: { done: true } };
};

type BlockerDefs = {
  fetchA: { entry: true; input: { url: string }; output: { a: string } };
  fetchB: { entry: true; input: { url: string }; output: { b: number } };
  auth: { entry: true; input: null; output: { token: string } };
  main: {
    entry: true;
    input: null;
    output: { done: true };
    blockers: [{ typeName: "auth" }, ...{ input: { url: string } }[]];
  };
};

describe("OutputJob variants", () => {
  it("carries the output and no successor", () => {
    type Result = OutputJob<string, LinearDefs, "step", "entry">;
    expectTypeOf<Result["output"]>().toEqualTypeOf<{ stepResult: number }>();
    expectTypeOf<Result["continuedToId"]>().toEqualTypeOf<null>();
    expectTypeOf<Result["chainTypeName"]>().toEqualTypeOf<"entry">();
  });

  it("is never for a job type without output", () => {
    expectTypeOf<OutputJob<string, ContinuingOnlyDefs, "head", "head">>().toBeNever();
  });
});

describe("ContinuedJob variants", () => {
  it("has no output and points at the successor", () => {
    type Result = ContinuedJob<string, ContinuingOnlyDefs, "head", "head", "tail">;
    expectTypeOf<Result["continuedToId"]>().toEqualTypeOf<string>();
    expectTypeOf<Result["output"]>().toEqualTypeOf<undefined>();
    expectTypeOf<Result["continuedTo"]["chainTypeName"]>().toEqualTypeOf<"head">();
  });

  it("is never for a job type that cannot continue", () => {
    expectTypeOf<ContinuedJob<string, TerminalOnlyDefs, "only", "only", "only">>().toBeNever();
  });
});

describe("RescheduledJob", () => {
  type Result = RescheduledJob<string, LinearDefs, "entry", "entry">;

  it("is the pending variant of the job", () => {
    expectTypeOf<Result["status"]>().toEqualTypeOf<"pending">();
    expectTypeOf<Result["typeName"]>().toEqualTypeOf<"entry">();
    expectTypeOf<Result["input"]>().toEqualTypeOf<{ value: number }>();
  });

  it("is the pending member of ResolvedJob", () => {
    expectTypeOf<Result>().toExtend<ResolvedJob<string, LinearDefs, "entry", "entry">>();
    expectTypeOf<
      Extract<ResolvedJob<string, LinearDefs, "entry", "entry">, { status: "pending" }>
    >().toExtend<Result>();
  });
});

describe("ResolvedRunningJob", () => {
  type Result = ResolvedRunningJob<string, BlockerDefs, "main">;

  it("is the running variant with attempt fields", () => {
    expectTypeOf<Result["status"]>().toEqualTypeOf<"running">();
    expectTypeOf<Result["attemptBy"]>().toEqualTypeOf<string>();
    expectTypeOf<Result["attemptUntil"]>().toEqualTypeOf<Date | null>();
  });

  it("defaults the chain type name to the reaching entry", () => {
    expectTypeOf<Result["chainTypeName"]>().toEqualTypeOf<"main">();
  });

  it("does not carry blocker chains", () => {
    expectTypeOf<Result>().not.toHaveProperty("blockers");
  });
});

describe("CompletedBlockerChains", () => {
  type Blockers = CompletedBlockerChains<string, BlockerDefs, "main">;

  it("narrows a nominal slot to the completed chain", () => {
    expectTypeOf<Blockers[0]["status"]>().toEqualTypeOf<"completed">();
    expectTypeOf<Blockers[0]["output"]>().toEqualTypeOf<{ token: string }>();
  });

  it("narrows a structural rest slot to a union of completed chains", () => {
    type Rest = Blockers[1];
    expectTypeOf<Rest["typeName"]>().toEqualTypeOf<"fetchA" | "fetchB">();
    expectTypeOf<Extract<Rest, { typeName: "fetchA" }>["output"]>().toEqualTypeOf<{
      a: string;
    }>();
    expectTypeOf<Extract<Rest, { typeName: "fetchB" }>["output"]>().toEqualTypeOf<{
      b: number;
    }>();
  });

  it("matches the completed members of BlockerChains", () => {
    expectTypeOf<Blockers[0]>().toEqualTypeOf<
      ResolvedCompletedChain<string, BlockerDefs, "auth">
    >();
    expectTypeOf<
      Extract<BlockerChains<string, BlockerDefs, "main">[0], { status: "completed" }>
    >().toExtend<Blockers[0]>();
  });

  it("is an empty tuple for a job type without blockers", () => {
    expectTypeOf<CompletedBlockerChains<string, BlockerDefs, "auth">>().toEqualTypeOf<[]>();
  });
});

describe("ResolvedChain variants", () => {
  it("ResolvedCompletedChain carries the chain output", () => {
    type Result = ResolvedCompletedChain<string, ContinuingOnlyDefs, "head">;
    expectTypeOf<Result["status"]>().toEqualTypeOf<"completed">();
    expectTypeOf<Result["input"]>().toEqualTypeOf<{ h: 1 }>();
    expectTypeOf<Result["output"]>().toEqualTypeOf<{ done: true }>();
  });

  it("ResolvedRunningChain has no output", () => {
    type Result = ResolvedRunningChain<string, ContinuingOnlyDefs, "head">;
    expectTypeOf<Result["status"]>().toEqualTypeOf<"running">();
    expectTypeOf<Result>().not.toHaveProperty("output");
  });

  it("both distribute over a union of entry type names", () => {
    type Completed = ResolvedCompletedChain<string, BlockerDefs, "fetchA" | "fetchB">;
    expectTypeOf<Extract<Completed, { typeName: "fetchB" }>["output"]>().toEqualTypeOf<{
      b: number;
    }>();
    type Running = ResolvedRunningChain<string, BlockerDefs, "fetchA" | "fetchB">;
    expectTypeOf<Running["typeName"]>().toEqualTypeOf<"fetchA" | "fetchB">();
  });

  it("variants are the members of ResolvedChain", () => {
    type Chain = ResolvedChain<string, ContinuingOnlyDefs, "head">;
    expectTypeOf<ResolvedCompletedChain<string, ContinuingOnlyDefs, "head">>().toExtend<Chain>();
    expectTypeOf<ResolvedRunningChain<string, ContinuingOnlyDefs, "head">>().toExtend<Chain>();
    expectTypeOf<Chain>().toExtend<
      | ResolvedCompletedChain<string, ContinuingOnlyDefs, "head">
      | ResolvedRunningChain<string, ContinuingOnlyDefs, "head">
    >();
  });
});

describe("JobTypeReachingEntry", () => {
  it("keeps an any type name as any", () => {
    expectTypeOf<JobTypeReachingEntry<LinearDefs, any>>().toBeAny();
  });

  it("is never for a name outside the definitions", () => {
    expectTypeOf<JobTypeReachingEntry<LinearDefs, "missing">>().toBeNever();
  });

  it("collects every entry that reaches a shared job type", () => {
    type Defs = {
      e1: { entry: true; input: { a: 1 }; continueWith: { typeName: "shared" } };
      e2: { entry: true; input: { b: 1 }; continueWith: { typeName: "shared" } };
      shared: { input: { s: 1 }; output: { done: true } };
    };
    expectTypeOf<JobTypeReachingEntry<Defs, "shared">>().toEqualTypeOf<"e1" | "e2">();
  });
});
