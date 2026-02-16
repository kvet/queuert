import { describe, expectTypeOf, it } from "vitest";
import {
  type BlockerChains,
  type ChainJobTypes,
  type ChainTypesReaching,
  type ContinuationJobTypes,
  type EntryJobTypeDefinitions,
  type JobChainOf,
  type JobOf,
  defineJobTypes,
} from "./job-type.js";

describe("defineJobTypes", () => {
  describe("validation", () => {
    it("allows valid job type definitions", () => {
      // All valid JSON-like types should work
      const defs = defineJobTypes<{
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

      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("nullInput");
      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("booleanInput");
      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("numberInput");
      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("stringInput");
      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("objectInput");
      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("arrayInput");
      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("nestedInput");
    });

    it("rejects void as input", () => {
      // @ts-expect-error void is not allowed as input
      defineJobTypes<{
        invalid: { input: void; output: { done: true } };
      }>();
    });

    it("rejects undefined as input", () => {
      // @ts-expect-error undefined is not allowed as input
      defineJobTypes<{
        invalid: { input: undefined; output: { done: true } };
      }>();
    });

    it("rejects void as terminal output", () => {
      // @ts-expect-error void is not allowed as terminal output
      defineJobTypes<{
        invalid: { input: null; output: void };
      }>();
    });

    it("rejects undefined as terminal output", () => {
      // @ts-expect-error undefined is not allowed as terminal output
      defineJobTypes<{
        invalid: { input: null; output: undefined };
      }>();
    });

    it("allows pure continuation outputs", () => {
      // Pure continuation output should be valid
      const defs = defineJobTypes<{
        first: { entry: true; input: null; continueWith: { typeName: "second" } };
        second: { input: null; output: { done: true } };
      }>();

      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("first");
      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("second");
    });

    it("allows mixed continuation and terminal outputs", () => {
      // Can continue or complete (continueWith with non-null output)
      const defs = defineJobTypes<{
        loop: {
          input: { counter: number };
          output: { done: true };
          continueWith: { typeName: "loop" };
        };
      }>();

      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("loop");
    });

    it("rejects continueWith referencing undefined job type", () => {
      // @ts-expect-error "nonexistent" is not a defined job type
      defineJobTypes<{
        start: { input: null; continueWith: { typeName: "nonexistent" } };
      }>();
    });

    it("rejects blockers referencing undefined job type", () => {
      // @ts-expect-error "nonexistent" is not a defined job type
      defineJobTypes<{
        main: {
          input: null;
          output: { done: true };
          blockers: [{ typeName: "nonexistent" }];
        };
      }>();
    });

    it("rejects blockers referencing continuation-only job type", () => {
      // @ts-expect-error "internal" is a continuation-only type, cannot be a blocker
      defineJobTypes<{
        start: { entry: true; input: null; continueWith: { typeName: "internal" } };
        internal: { input: null; output: { done: true } };
        main: {
          entry: true;
          input: { id: string };
          output: { result: number };
          blockers: [{ typeName: "internal" }];
        };
      }>();
    });

    it("allows valid continueWith references", () => {
      const defs = defineJobTypes<{
        first: { entry: true; input: null; continueWith: { typeName: "second" } };
        second: { input: null; output: { done: true } };
      }>();

      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("first");
      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("second");
    });

    it("allows valid blocker references", () => {
      const defs = defineJobTypes<{
        blocker: { entry: true; input: { value: number }; output: { result: number } };
        main: {
          entry: true;
          input: null;
          output: { done: true };
          blockers: [{ typeName: "blocker" }];
        };
      }>();

      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("blocker");
      expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("main");
    });
  });
});

describe("continuation-only jobs (default behavior)", () => {
  it("supports null as input type", () => {
    const defs = defineJobTypes<{
      first: { entry: true; input: { start: true }; continueWith: { typeName: "second" } };
      second: { input: null; output: { done: true } };
    }>();

    type SecondJob = JobOf<string, (typeof defs)["$definitions"], "second">;
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<null>();
  });

  it("supports object types", () => {
    const defs = defineJobTypes<{
      first: { entry: true; input: null; continueWith: { typeName: "second" } };
      second: {
        input: { value: number; name: string };
        output: { done: true };
      };
    }>();

    type SecondJob = JobOf<string, (typeof defs)["$definitions"], "second">;
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<{ value: number; name: string }>();
  });

  it("supports primitive types", () => {
    const defs = defineJobTypes<{
      first: { entry: true; input: null; continueWith: { typeName: "second" } };
      second: { input: number; output: { done: true } };
    }>();

    type SecondJob = JobOf<string, (typeof defs)["$definitions"], "second">;
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<number>();
  });

  it("supports array types", () => {
    const defs = defineJobTypes<{
      first: { entry: true; input: null; continueWith: { typeName: "second" } };
      second: { input: string[]; output: { done: true } };
    }>();

    type SecondJob = JobOf<string, (typeof defs)["$definitions"], "second">;
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<string[]>();
  });

  it("rejects void as continuation input", () => {
    // @ts-expect-error void is not allowed as input
    defineJobTypes<{
      first: { entry: true; input: null; continueWith: { typeName: "second" } };
      second: { input: void; output: { done: true } };
    }>();
  });

  it("rejects undefined as continuation input", () => {
    // @ts-expect-error undefined is not allowed as input
    defineJobTypes<{
      first: { entry: true; input: null; continueWith: { typeName: "second" } };
      second: { input: undefined; output: { done: true } };
    }>();
  });
});

describe("EntryJobTypeDefinitions", () => {
  it("includes only job types with entry: true", () => {
    type Defs = {
      public: { entry: true; input: { id: string }; continueWith: { typeName: "internal" } };
      internal: { input: { data: number }; output: { done: true } };
      alsoPublic: { entry: true; input: null; output: { result: string } };
    };

    type EntryDefs = EntryJobTypeDefinitions<Defs>;

    expectTypeOf<keyof EntryDefs>().toEqualTypeOf<"public" | "alsoPublic">();
  });

  it("returns empty when no types have entry: true", () => {
    type Defs = {
      a: { input: null; output: { done: true } };
      b: { input: { x: number }; output: { done: true } };
    };

    type EntryDefs = EntryJobTypeDefinitions<Defs>;

    expectTypeOf<keyof EntryDefs>().toEqualTypeOf<never>();
  });
});

describe("JobOf", () => {
  it("extracts input type correctly for continuation jobs", () => {
    const defs = defineJobTypes<{
      first: { entry: true; input: { value: number }; continueWith: { typeName: "second" } };
      second: {
        input: { continued: boolean };
        output: { done: true };
      };
    }>();

    type FirstJob = JobOf<string, (typeof defs)["$definitions"], "first">;
    type SecondJob = JobOf<string, (typeof defs)["$definitions"], "second">;

    expectTypeOf<FirstJob["input"]>().toEqualTypeOf<{ value: number }>();
    expectTypeOf<SecondJob["input"]>().toEqualTypeOf<{ continued: boolean }>();
  });

  it("preserves job metadata types", () => {
    const defs = defineJobTypes<{
      test: { entry: true; input: { id: string }; output: { result: number } };
    }>();

    type TestJob = JobOf<string, (typeof defs)["$definitions"], "test">;

    expectTypeOf<TestJob["id"]>().toEqualTypeOf<string>();
    expectTypeOf<TestJob["chainId"]>().toEqualTypeOf<string>();
    expectTypeOf<TestJob["typeName"]>().toEqualTypeOf<"test">();
    expectTypeOf<TestJob["createdAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<TestJob["attempt"]>().toEqualTypeOf<number>();
  });
});

describe("ContinuationJobTypes", () => {
  it("resolves continuation types from continueWith", () => {
    const defs = defineJobTypes<{
      first: { entry: true; input: null; continueWith: { typeName: "second" } };
      second: { input: null; output: { done: true } };
    }>();

    type NextFromFirst = ContinuationJobTypes<(typeof defs)["$definitions"], "first">;

    expectTypeOf<NextFromFirst>().toEqualTypeOf<"second">();
  });

  it("resolves union of continuation types", () => {
    const defs = defineJobTypes<{
      start: {
        entry: true;
        input: null;

        continueWith: { typeName: "branchA" | "branchB" };
      };
      branchA: { input: null; output: { a: true } };
      branchB: { input: null; output: { b: true } };
    }>();

    type NextFromStart = ContinuationJobTypes<(typeof defs)["$definitions"], "start">;

    expectTypeOf<NextFromStart>().toEqualTypeOf<"branchA" | "branchB">();
  });

  it("returns never for terminal jobs", () => {
    const defs = defineJobTypes<{
      terminal: { entry: true; input: null; output: { done: true } };
    }>();

    type NextFromTerminal = ContinuationJobTypes<(typeof defs)["$definitions"], "terminal">;

    expectTypeOf<NextFromTerminal>().toEqualTypeOf<never>();
  });
});

describe("ChainJobTypes", () => {
  it("collects all job types in a chain", () => {
    const defs = defineJobTypes<{
      first: { entry: true; input: null; continueWith: { typeName: "second" } };
      second: { input: null; continueWith: { typeName: "third" } };
      third: { input: null; output: { done: true } };
      unrelated: { entry: true; input: { other: true }; output: { other: true } };
    }>();

    type ChainTypes = ChainJobTypes<(typeof defs)["$definitions"], "first">;

    expectTypeOf<ChainTypes>().toEqualTypeOf<"first" | "second" | "third">();
  });

  it("handles loops without infinite recursion", () => {
    const defs = defineJobTypes<{
      loop: {
        entry: true;
        input: { counter: number };
        output: { done: true };
        continueWith: { typeName: "loop" };
      };
    }>();

    type ChainTypes = ChainJobTypes<(typeof defs)["$definitions"], "loop">;

    expectTypeOf<ChainTypes>().toEqualTypeOf<"loop">();
  });
});

describe("BlockerChains", () => {
  it("resolves blocker chain types", () => {
    const defs = defineJobTypes<{
      blocker: { entry: true; input: { value: number }; output: { result: number } };
      main: {
        entry: true;
        input: { start: boolean };
        output: { finalResult: number };
        blockers: [{ typeName: "blocker" }];
      };
    }>();

    type MainBlockers = BlockerChains<string, (typeof defs)["$definitions"], "main">;

    // Should be a tuple with one blocker chain - verify it's an array type
    expectTypeOf<MainBlockers>().toBeArray();
  });

  it("returns empty tuple for jobs without blockers", () => {
    const defs = defineJobTypes<{
      simple: { entry: true; input: null; output: { done: true } };
    }>();

    type SimpleBlockers = BlockerChains<string, (typeof defs)["$definitions"], "simple">;

    expectTypeOf<SimpleBlockers>().toEqualTypeOf<[]>();
  });
});

describe("JobChainOf", () => {
  it("extracts input types correctly for chains", () => {
    const defs = defineJobTypes<{
      first: { entry: true; input: { start: number }; continueWith: { typeName: "second" } };
      second: {
        input: { continued: string };
        output: { done: true };
      };
    }>();

    type Chain = JobChainOf<string, (typeof defs)["$definitions"], "first">;

    // The chain input should be the type from each job in the chain
    type ChainInput = Chain extends { input: infer I } ? I : never;

    // Input can be either first job's input or second job's input
    expectTypeOf<ChainInput>().toEqualTypeOf<{ start: number } | { continued: string }>();
  });
});

describe("ChainTypesReaching", () => {
  it("computes reaching chain types for complex job graphs", () => {
    // Complex graph with:
    // - 5 entry points
    // - Multiple shared internal jobs reachable from different chains
    // - Branching paths
    // - Deep chains (up to 6 levels)
    // - Diamond patterns (multiple paths converging)
    const defs = defineJobTypes<{
      // Entry points
      entryA: { entry: true; input: { a: true }; continueWith: { typeName: "sharedStep1" } };
      entryB: { entry: true; input: { b: true }; continueWith: { typeName: "sharedStep1" } };
      entryC: { entry: true; input: { c: true }; continueWith: { typeName: "branchC1" } };
      entryD: { entry: true; input: { d: true }; continueWith: { typeName: "deepChain1" } };
      entryE: {
        entry: true;
        input: { e: true };

        continueWith: { typeName: "branchE1" | "branchE2" };
      };

      // Shared step reachable from A and B
      sharedStep1: {
        input: { step: 1 };

        continueWith: { typeName: "sharedStep2" };
      };
      sharedStep2: {
        input: { step: 2 };

        continueWith: { typeName: "finalShared" };
      };
      finalShared: {
        input: { final: true };
        output: { done: "shared" };
      };

      // Branch from C
      branchC1: {
        input: { c1: true };

        continueWith: { typeName: "branchC2" };
      };
      branchC2: {
        input: { c2: true };

        continueWith: { typeName: "finalShared" }; // Converges to shared final
      };

      // Deep chain from D (6 levels)
      deepChain1: {
        input: { depth: 1 };

        continueWith: { typeName: "deepChain2" };
      };
      deepChain2: {
        input: { depth: 2 };

        continueWith: { typeName: "deepChain3" };
      };
      deepChain3: {
        input: { depth: 3 };

        continueWith: { typeName: "deepChain4" };
      };
      deepChain4: {
        input: { depth: 4 };

        continueWith: { typeName: "deepChain5" };
      };
      deepChain5: {
        input: { depth: 5 };

        continueWith: { typeName: "deepChain6" };
      };
      deepChain6: {
        input: { depth: 6 };
        output: { done: "deep" };
      };

      // Branches from E (both converge to same final)
      branchE1: {
        input: { e1: true };

        continueWith: { typeName: "convergencePoint" };
      };
      branchE2: {
        input: { e2: true };

        continueWith: { typeName: "convergencePoint" };
      };
      convergencePoint: {
        input: { converged: true };
        output: { done: "converged" };
      };
    }>();

    // Entry points reach only themselves
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "entryA">
    >().toEqualTypeOf<"entryA">();
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "entryB">
    >().toEqualTypeOf<"entryB">();
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "entryC">
    >().toEqualTypeOf<"entryC">();
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "entryD">
    >().toEqualTypeOf<"entryD">();
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "entryE">
    >().toEqualTypeOf<"entryE">();

    // Shared steps reachable from A and B
    expectTypeOf<ChainTypesReaching<(typeof defs)["$definitions"], "sharedStep1">>().toEqualTypeOf<
      "entryA" | "entryB"
    >();
    expectTypeOf<ChainTypesReaching<(typeof defs)["$definitions"], "sharedStep2">>().toEqualTypeOf<
      "entryA" | "entryB"
    >();

    // Final shared is reachable from A, B, and C (via diamond pattern)
    expectTypeOf<ChainTypesReaching<(typeof defs)["$definitions"], "finalShared">>().toEqualTypeOf<
      "entryA" | "entryB" | "entryC"
    >();

    // C-only branches
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "branchC1">
    >().toEqualTypeOf<"entryC">();
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "branchC2">
    >().toEqualTypeOf<"entryC">();

    // Deep chain only from D
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "deepChain1">
    >().toEqualTypeOf<"entryD">();
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "deepChain6">
    >().toEqualTypeOf<"entryD">();

    // E branches and convergence point
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "branchE1">
    >().toEqualTypeOf<"entryE">();
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "branchE2">
    >().toEqualTypeOf<"entryE">();
    expectTypeOf<
      ChainTypesReaching<(typeof defs)["$definitions"], "convergencePoint">
    >().toEqualTypeOf<"entryE">();

    // JobOf uses the computed chain type by default
    type SharedStep1Job = JobOf<string, (typeof defs)["$definitions"], "sharedStep1">;
    expectTypeOf<SharedStep1Job["chainTypeName"]>().toEqualTypeOf<"entryA" | "entryB">();

    type FinalSharedJob = JobOf<string, (typeof defs)["$definitions"], "finalShared">;
    expectTypeOf<FinalSharedJob["chainTypeName"]>().toEqualTypeOf<"entryA" | "entryB" | "entryC">();

    // Can narrow with explicit 4th param
    type FinalSharedFromA = JobOf<string, (typeof defs)["$definitions"], "finalShared", "entryA">;
    expectTypeOf<FinalSharedFromA["chainTypeName"]>().toEqualTypeOf<"entryA">();
  });
});

describe("structural references", () => {
  it("resolves structural reference to single matching type", () => {
    const defs = defineJobTypes<{
      router: {
        entry: true;
        input: { path: string };
        continueWith: { input: { payload: unknown } };
      };
      handler: {
        input: { payload: unknown };
        output: { result: string };
      };
    }>();

    type NextFromRouter = ContinuationJobTypes<(typeof defs)["$definitions"], "router">;

    expectTypeOf<NextFromRouter>().toEqualTypeOf<"handler">();
  });

  it("resolves structural reference to union of matching types", () => {
    const defs = defineJobTypes<{
      router: {
        entry: true;
        input: { path: string };
        continueWith: { input: { payload: unknown } };
      };
      handlerA: {
        input: { payload: unknown };
        output: { result: string };
      };
      handlerB: {
        input: { payload: unknown };
        output: { result: number };
      };
    }>();

    type NextFromRouter = ContinuationJobTypes<(typeof defs)["$definitions"], "router">;

    expectTypeOf<NextFromRouter>().toEqualTypeOf<"handlerA" | "handlerB">();
  });

  it("rejects structural reference with no matching types", () => {
    // @ts-expect-error no job type has input { nonexistent: boolean }
    defineJobTypes<{
      router: {
        entry: true;
        input: { path: string };
        continueWith: { input: { nonexistent: boolean } };
      };
      handler: {
        input: { payload: unknown };
        output: { result: string };
      };
    }>();
  });

  it("allows combined nominal and structural references in continueWith", () => {
    const defs = defineJobTypes<{
      router: {
        entry: true;
        input: { path: string };
        continueWith: { typeName: "handlerA" } | { input: { payload: unknown } };
      };
      handlerA: {
        input: { id: string };
        output: { result: string };
      };
      handlerB: {
        input: { payload: unknown };
        output: { result: number };
      };
    }>();

    type NextFromRouter = ContinuationJobTypes<(typeof defs)["$definitions"], "router">;

    // handlerA from nominal, handlerB from structural
    expectTypeOf<NextFromRouter>().toEqualTypeOf<"handlerA" | "handlerB">();
  });
});

describe("structural references in blockers", () => {
  it("resolves structural blocker reference to matching type", () => {
    const defs = defineJobTypes<{
      auth: { entry: true; input: { token: string }; output: { userId: string } };
      main: {
        entry: true;
        input: { data: string };
        output: { done: boolean };
        blockers: [{ input: { token: string } }];
      };
    }>();

    type MainBlockers = BlockerChains<string, (typeof defs)["$definitions"], "main">;

    expectTypeOf<MainBlockers>().toBeArray();
  });

  it("resolves structural blocker to union of matching types", () => {
    const defs = defineJobTypes<{
      authA: { entry: true; input: { token: string }; output: { userId: string } };
      authB: { entry: true; input: { token: string }; output: { userId: string; extra: boolean } };
      main: {
        entry: true;
        input: { data: string };
        output: { done: boolean };
        blockers: [{ input: { token: string } }];
      };
    }>();

    type MainBlockers = BlockerChains<string, (typeof defs)["$definitions"], "main">;

    expectTypeOf<MainBlockers>().toBeArray();
  });
});

describe("rest/variadic blocker slots", () => {
  it("allows rest blocker slots with spread syntax", () => {
    const defs = defineJobTypes<{
      auth: { entry: true; input: { token: string }; output: { userId: string } };
      validator: { entry: true; input: { data: unknown }; output: { valid: boolean } };
      main: {
        entry: true;
        input: { data: string };
        output: { done: boolean };
        blockers: [{ typeName: "auth" }, ...{ typeName: "validator" }[]];
      };
    }>();

    expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("main");

    type MainBlockers = BlockerChains<string, (typeof defs)["$definitions"], "main">;
    expectTypeOf<MainBlockers>().toBeArray();
  });

  it("allows rest-only blocker slots", () => {
    const defs = defineJobTypes<{
      processor: { entry: true; input: { item: unknown }; output: { processed: boolean } };
      aggregator: {
        entry: true;
        input: { data: string };
        output: { done: boolean };
        blockers: { typeName: "processor" }[];
      };
    }>();

    expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("aggregator");

    type AggregatorBlockers = BlockerChains<string, (typeof defs)["$definitions"], "aggregator">;
    expectTypeOf<AggregatorBlockers>().toBeArray();
  });

  it("allows mixed fixed and rest blocker slots", () => {
    const defs = defineJobTypes<{
      auth: { entry: true; input: { token: string }; output: { userId: string } };
      config: { entry: true; input: { key: string }; output: { value: string } };
      processor: { entry: true; input: { item: unknown }; output: { processed: boolean } };
      main: {
        entry: true;
        input: { data: string };
        output: { done: boolean };
        blockers: [{ typeName: "auth" }, { typeName: "config" }, ...{ typeName: "processor" }[]];
      };
    }>();

    expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("main");

    type MainBlockers = BlockerChains<string, (typeof defs)["$definitions"], "main">;
    expectTypeOf<MainBlockers>().toBeArray();
  });

  it("allows structural reference in rest blocker slots", () => {
    const defs = defineJobTypes<{
      processorA: { entry: true; input: { item: unknown }; output: { processed: boolean } };
      processorB: { entry: true; input: { item: unknown }; output: { processed: boolean } };
      aggregator: {
        entry: true;
        input: { data: string };
        output: { done: boolean };
        blockers: { input: { item: unknown } }[];
      };
    }>();

    expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("aggregator");

    type AggregatorBlockers = BlockerChains<string, (typeof defs)["$definitions"], "aggregator">;
    expectTypeOf<AggregatorBlockers>().toBeArray();
  });

  it("allows union of type names within a single blocker slot", () => {
    const defs = defineJobTypes<{
      auth: { entry: true; input: { token: string }; output: { userId: string } };
      authAlt: { entry: true; input: { token: string }; output: { userId: string } };
      main: {
        entry: true;
        input: { data: string };
        output: { done: boolean };
        blockers: [{ typeName: "auth" | "authAlt" }];
      };
    }>();

    expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("main");

    type MainBlockers = BlockerChains<string, (typeof defs)["$definitions"], "main">;
    expectTypeOf<MainBlockers>().toBeArray();
  });

  it("allows union of nominal and structural references in a single blocker slot", () => {
    const defs = defineJobTypes<{
      perform: { entry: true; input: { action: string }; output: { result: boolean } };
      performAlt: { entry: true; input: { action: string }; output: { result: boolean } };
      main: {
        entry: true;
        input: { data: string };
        output: { done: boolean };
        // Can be filled by 'perform' (nominal) OR any job with { action: string } input (structural)
        blockers: [{ typeName: "perform" } | { input: { action: string } }];
      };
    }>();

    expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("main");

    type MainBlockers = BlockerChains<string, (typeof defs)["$definitions"], "main">;
    expectTypeOf<MainBlockers>().toBeArray();
  });

  it("allows complex mixed references as shown in design doc", () => {
    const defs = defineJobTypes<{
      auth: { entry: true; input: { token: string }; output: { userId: string } };
      authAlt: { entry: true; input: { token: string }; output: { userId: string } };
      perform: { entry: true; input: { action: string }; output: { result: boolean } };
      main: {
        entry: true;
        input: { data: string };
        output: { done: boolean };
        blockers: [
          { typeName: "auth" | "authAlt" },
          { typeName: "perform" } | { input: { action: string } },
        ];
      };
    }>();

    expectTypeOf<(typeof defs)["$definitions"]>().toHaveProperty("main");

    type MainBlockers = BlockerChains<string, (typeof defs)["$definitions"], "main">;
    expectTypeOf<MainBlockers>().toBeArray();
  });
});
