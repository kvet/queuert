import { describe, it, expectTypeOf } from "vitest";
import {
  defineUnionJobTypes,
  DefineContinuationInput,
  DefineContinuationOutput,
  DefineBlocker,
  FirstJobTypeDefinitions,
  JobOf,
  ContinuationJobTypes,
  SequenceJobTypes,
  BlockerSequences,
  JobSequenceOf,
} from "./job-type.js";

describe("defineUnionJobTypes", () => {
  describe("validation", () => {
    it("allows valid job type definitions", () => {
      // All valid JSON-like types should work
      const defs = defineUnionJobTypes<{
        nullInput: { input: null; output: { done: true } };
        booleanInput: { input: boolean; output: { done: true } };
        numberInput: { input: number; output: { done: true } };
        stringInput: { input: string; output: { done: true } };
        objectInput: { input: { foo: string; bar: number }; output: { done: true } };
        arrayInput: { input: string[]; output: { done: true } };
        nestedInput: {
          input: { nested: { deeply: { value: number }[] } };
          output: { done: true };
        };
      }>();

      expectTypeOf(defs).toHaveProperty("nullInput");
      expectTypeOf(defs).toHaveProperty("booleanInput");
      expectTypeOf(defs).toHaveProperty("numberInput");
      expectTypeOf(defs).toHaveProperty("stringInput");
      expectTypeOf(defs).toHaveProperty("objectInput");
      expectTypeOf(defs).toHaveProperty("arrayInput");
      expectTypeOf(defs).toHaveProperty("nestedInput");
    });

    it("rejects void as input", () => {
      // @ts-expect-error void is not allowed as input
      defineUnionJobTypes<{
        invalid: { input: void; output: { done: true } };
      }>();
    });

    it("rejects undefined as input", () => {
      // @ts-expect-error undefined is not allowed as input
      defineUnionJobTypes<{
        invalid: { input: undefined; output: { done: true } };
      }>();
    });

    it("rejects void as terminal output", () => {
      // @ts-expect-error void is not allowed as terminal output
      defineUnionJobTypes<{
        invalid: { input: null; output: void };
      }>();
    });

    it("rejects undefined as terminal output", () => {
      // @ts-expect-error undefined is not allowed as terminal output
      defineUnionJobTypes<{
        invalid: { input: null; output: undefined };
      }>();
    });

    it("allows pure continuation outputs", () => {
      // Pure continuation output should be valid (no terminal output to validate)
      const defs = defineUnionJobTypes<{
        first: { input: null; output: DefineContinuationOutput<"second"> };
        second: { input: DefineContinuationInput<null>; output: { done: true } };
      }>();

      expectTypeOf(defs).toHaveProperty("first");
      expectTypeOf(defs).toHaveProperty("second");
    });

    it("allows mixed continuation and terminal outputs", () => {
      // Can continue or complete
      const defs = defineUnionJobTypes<{
        loop: {
          input: { counter: number };
          output: DefineContinuationOutput<"loop"> | { done: true };
        };
      }>();

      expectTypeOf(defs).toHaveProperty("loop");
    });

    it("rejects void in mixed outputs", () => {
      // @ts-expect-error void is not allowed even in mixed output
      defineUnionJobTypes<{
        invalid: {
          input: null;
          output: DefineContinuationOutput<"invalid"> | void;
        };
      }>();
    });

    it("rejects DefineContinuationOutput referencing undefined job type", () => {
      // @ts-expect-error "nonexistent" is not a defined job type
      defineUnionJobTypes<{
        start: { input: null; output: DefineContinuationOutput<"nonexistent"> };
      }>();
    });

    it("rejects DefineBlocker referencing undefined job type", () => {
      // @ts-expect-error "nonexistent" is not a defined job type
      defineUnionJobTypes<{
        main: {
          input: null;
          output: { done: true };
          blockers: [DefineBlocker<"nonexistent">];
        };
      }>();
    });

    it("rejects DefineBlocker referencing continuation-only job type", () => {
      // @ts-expect-error "internal" is a continuation-only type, cannot be a blocker
      defineUnionJobTypes<{
        start: { input: null; output: DefineContinuationOutput<"internal"> };
        internal: { input: DefineContinuationInput<null>; output: { done: true } };
        main: {
          input: { id: string };
          output: { result: number };
          blockers: [DefineBlocker<"internal">];
        };
      }>();
    });

    it("allows valid DefineContinuationOutput references", () => {
      const defs = defineUnionJobTypes<{
        first: { input: null; output: DefineContinuationOutput<"second"> };
        second: { input: DefineContinuationInput<null>; output: { done: true } };
      }>();

      expectTypeOf(defs).toHaveProperty("first");
      expectTypeOf(defs).toHaveProperty("second");
    });

    it("allows valid DefineBlocker references", () => {
      const defs = defineUnionJobTypes<{
        blocker: { input: { value: number }; output: { result: number } };
        main: {
          input: null;
          output: { done: true };
          blockers: [DefineBlocker<"blocker">];
        };
      }>();

      expectTypeOf(defs).toHaveProperty("blocker");
      expectTypeOf(defs).toHaveProperty("main");
    });
  });
});

describe("DefineContinuationInput", () => {
  it("supports null as inner type", () => {
    const defs = defineUnionJobTypes<{
      first: { input: { start: true }; output: DefineContinuationOutput<"second"> };
      second: { input: DefineContinuationInput<null>; output: { done: true } };
    }>();

    type SecondJob = JobOf<string, typeof defs, "second">;
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<null>();
  });

  it("supports object types", () => {
    const defs = defineUnionJobTypes<{
      first: { input: null; output: DefineContinuationOutput<"second"> };
      second: {
        input: DefineContinuationInput<{ value: number; name: string }>;
        output: { done: true };
      };
    }>();

    type SecondJob = JobOf<string, typeof defs, "second">;
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<{ value: number; name: string }>();
  });

  it("supports primitive types", () => {
    const defs = defineUnionJobTypes<{
      first: { input: null; output: DefineContinuationOutput<"second"> };
      second: { input: DefineContinuationInput<number>; output: { done: true } };
    }>();

    type SecondJob = JobOf<string, typeof defs, "second">;
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<number>();
  });

  it("supports array types", () => {
    const defs = defineUnionJobTypes<{
      first: { input: null; output: DefineContinuationOutput<"second"> };
      second: { input: DefineContinuationInput<string[]>; output: { done: true } };
    }>();

    type SecondJob = JobOf<string, typeof defs, "second">;
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<string[]>();
  });

  it("rejects void in continuation input", () => {
    // @ts-expect-error void is not allowed in DefineContinuationInput
    defineUnionJobTypes<{
      first: { input: null; output: DefineContinuationOutput<"second"> };
      second: { input: DefineContinuationInput<void>; output: { done: true } };
    }>();
  });

  it("rejects undefined in continuation input", () => {
    // @ts-expect-error undefined is not allowed in DefineContinuationInput
    defineUnionJobTypes<{
      first: { input: null; output: DefineContinuationOutput<"second"> };
      second: { input: DefineContinuationInput<undefined>; output: { done: true } };
    }>();
  });
});

describe("FirstJobTypeDefinitions", () => {
  it("filters out continuation-only job types", () => {
    type Defs = {
      public: { input: { id: string }; output: DefineContinuationOutput<"internal"> };
      internal: { input: DefineContinuationInput<{ data: number }>; output: { done: true } };
      alsoPublic: { input: null; output: { result: string } };
    };

    type FirstDefs = FirstJobTypeDefinitions<Defs>;

    expectTypeOf<keyof FirstDefs>().toEqualTypeOf<"public" | "alsoPublic">();
  });

  it("returns empty when all are continuation types", () => {
    type Defs = {
      a: { input: DefineContinuationInput<null>; output: { done: true } };
      b: { input: DefineContinuationInput<{ x: number }>; output: { done: true } };
    };

    type FirstDefs = FirstJobTypeDefinitions<Defs>;

    expectTypeOf<keyof FirstDefs>().toEqualTypeOf<never>();
  });
});

describe("JobOf", () => {
  it("unwraps DefineContinuationInput for job.input", () => {
    const defs = defineUnionJobTypes<{
      first: { input: { value: number }; output: DefineContinuationOutput<"second"> };
      second: {
        input: DefineContinuationInput<{ continued: boolean }>;
        output: { done: true };
      };
    }>();

    type FirstJob = JobOf<string, typeof defs, "first">;
    type SecondJob = JobOf<string, typeof defs, "second">;

    expectTypeOf<FirstJob["input"]>().toEqualTypeOf<{ value: number }>();
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<{ continued: boolean }>();
  });

  it("preserves job metadata types", () => {
    const defs = defineUnionJobTypes<{
      test: { input: { id: string }; output: { result: number } };
    }>();

    type TestJob = JobOf<string, typeof defs, "test">;

    expectTypeOf<TestJob["id"]>().toEqualTypeOf<string>();
    expectTypeOf<TestJob["sequenceId"]>().toEqualTypeOf<string>();
    expectTypeOf<TestJob["originId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<TestJob["rootId"]>().toEqualTypeOf<string>();
    expectTypeOf<TestJob["typeName"]>().toEqualTypeOf<"test">();
    expectTypeOf<TestJob["createdAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<TestJob["attempt"]>().toEqualTypeOf<number>();
  });
});

describe("ContinuationJobTypes", () => {
  it("resolves continuation types from DefineContinuationOutput", () => {
    const defs = defineUnionJobTypes<{
      first: { input: null; output: DefineContinuationOutput<"second"> };
      second: { input: DefineContinuationInput<null>; output: { done: true } };
    }>();

    type NextFromFirst = ContinuationJobTypes<typeof defs, "first">;

    expectTypeOf<NextFromFirst>().toEqualTypeOf<"second">();
  });

  it("resolves union of continuation types", () => {
    const defs = defineUnionJobTypes<{
      start: {
        input: null;
        output: DefineContinuationOutput<"branchA"> | DefineContinuationOutput<"branchB">;
      };
      branchA: { input: DefineContinuationInput<null>; output: { a: true } };
      branchB: { input: DefineContinuationInput<null>; output: { b: true } };
    }>();

    type NextFromStart = ContinuationJobTypes<typeof defs, "start">;

    expectTypeOf<NextFromStart>().toEqualTypeOf<"branchA" | "branchB">();
  });

  it("returns never for terminal jobs", () => {
    const defs = defineUnionJobTypes<{
      terminal: { input: null; output: { done: true } };
    }>();

    type NextFromTerminal = ContinuationJobTypes<typeof defs, "terminal">;

    expectTypeOf<NextFromTerminal>().toEqualTypeOf<never>();
  });
});

describe("SequenceJobTypes", () => {
  it("collects all job types in a sequence", () => {
    const defs = defineUnionJobTypes<{
      first: { input: null; output: DefineContinuationOutput<"second"> };
      second: { input: DefineContinuationInput<null>; output: DefineContinuationOutput<"third"> };
      third: { input: DefineContinuationInput<null>; output: { done: true } };
      unrelated: { input: { other: true }; output: { other: true } };
    }>();

    type SeqTypes = SequenceJobTypes<typeof defs, "first">;

    expectTypeOf<SeqTypes>().toEqualTypeOf<"first" | "second" | "third">();
  });

  it("handles loops without infinite recursion", () => {
    const defs = defineUnionJobTypes<{
      loop: {
        input: { counter: number };
        output: DefineContinuationOutput<"loop"> | { done: true };
      };
    }>();

    type SeqTypes = SequenceJobTypes<typeof defs, "loop">;

    expectTypeOf<SeqTypes>().toEqualTypeOf<"loop">();
  });
});

describe("BlockerSequences", () => {
  it("resolves blocker sequence types", () => {
    const defs = defineUnionJobTypes<{
      blocker: { input: { value: number }; output: { result: number } };
      main: {
        input: { start: boolean };
        output: { finalResult: number };
        blockers: [DefineBlocker<"blocker">];
      };
    }>();

    type MainBlockers = BlockerSequences<string, typeof defs, "main">;

    // Should be a tuple with one blocker sequence - verify it's an array type
    expectTypeOf<MainBlockers>().toBeArray();
  });

  it("returns empty tuple for jobs without blockers", () => {
    const defs = defineUnionJobTypes<{
      simple: { input: null; output: { done: true } };
    }>();

    type SimpleBlockers = BlockerSequences<string, typeof defs, "simple">;

    expectTypeOf<SimpleBlockers>().toEqualTypeOf<[]>();
  });
});

describe("JobSequenceOf", () => {
  it("unwraps DefineContinuationInput in sequence input types", () => {
    const defs = defineUnionJobTypes<{
      first: { input: { start: number }; output: DefineContinuationOutput<"second"> };
      second: {
        input: DefineContinuationInput<{ continued: string }>;
        output: { done: true };
      };
    }>();

    type Seq = JobSequenceOf<string, typeof defs, "first">;

    // The sequence input should be the unwrapped type
    type SeqInput = Seq extends { input: infer I } ? I : never;

    // Input can be either first job's input or second job's unwrapped input
    expectTypeOf<SeqInput>().toEqualTypeOf<{ start: number } | { continued: string }>();
  });
});
