import { describe, expectTypeOf, it } from "vitest";

import { type ContinuationJob, type ContinuedJob, type OutputJob } from "./job-types.resolvers.js";

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

// TODO: add more tests for other types
