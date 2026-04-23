import { type JobTypes } from "../entities/job-types.js";
import { JobTypeValidationError } from "../errors.js";
import { type ConformanceGroup } from "./runner.js";

/**
 * Builders that the adapter author supplies to satisfy the validation
 * conformance suite. Each builder's RETURN TYPE encodes the expected phantom
 * job type definitions, so the adapter's schema-to-shape mapper must thread
 * inference correctly to type-check at the call site of
 * {@link runValidationAdapterConformance}.
 *
 * Conformance verifies the wrapper layer only — the six runtime methods and
 * the way they integrate with core's `createJobTypes` error wrapping.
 * Compile-time validation rules (rejecting blockers that reference
 * continuation-only types, etc.) live in core's `ValidatedJobTypeDefinitions`
 * and are tested there; the positive type checks below are sufficient to
 * prove the adapter feeds them correctly.
 */
export type ValidationConformanceFixture = {
  /**
   * Optional hook called once after all conformance cases finish (pass or
   * fail) to release any resources the adapter held.
   */
  dispose?: () => Promise<void>;
  basic: {
    /** main: entry, input { id: string }, output { ok: boolean } — no continueWith, no blockers. */
    buildEntry: () => JobTypes<{
      main: {
        entry: true;
        input: { id: string };
        output: { ok: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
    /** internal: non-entry, input { id: string }, output { ok: boolean }. */
    buildNonEntry: () => JobTypes<{
      internal: {
        entry: undefined;
        input: { id: string };
        output: { ok: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
    /**
     * main → next (continuation-only entry):
     *   main: entry, input { id: string }, no output, continueWith nominal "next".
     *   next: non-entry, input { data: string }, output { done: boolean }.
     */
    buildContinuationOnly: () => JobTypes<{
      main: {
        entry: true;
        input: { id: string };
        output: undefined;
        continueWith: { typeName: "next" };
        blockers: undefined;
      };
      next: {
        entry: undefined;
        input: { data: string };
        output: { done: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
  };

  continuations: {
    /** step1 → step2 (nominal continueWith by name). */
    buildNominal: () => JobTypes<{
      step1: {
        entry: true;
        input: { id: string };
        output: undefined;
        continueWith: { typeName: "step2" };
        blockers: undefined;
      };
      step2: {
        entry: undefined;
        input: { data: unknown };
        output: { done: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
    /** router → handler (structural continueWith by input shape). */
    buildStructural: () => JobTypes<{
      router: {
        entry: true;
        input: { route: string };
        output: undefined;
        continueWith: { input: { payload: string } };
        blockers: undefined;
      };
      handler: {
        entry: undefined;
        input: { payload: string };
        output: { handled: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
  };

  blockers: {
    /** main blocked nominally by 'auth'. */
    buildNominal: () => JobTypes<{
      main: {
        entry: true;
        input: { id: string };
        output: { done: boolean };
        continueWith: undefined;
        blockers: readonly { typeName: "auth" }[];
      };
      auth: {
        entry: true;
        input: { token: string };
        output: { userId: string };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
    /** main blocked structurally by anything with input { token: string }. */
    buildStructural: () => JobTypes<{
      main: {
        entry: true;
        input: { id: string };
        output: { done: boolean };
        continueWith: undefined;
        blockers: readonly { input: { token: string } }[];
      };
      auth: {
        entry: true;
        input: { token: string };
        output: { userId: string };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
  };

  /**
   * Cross-slice external typing. Every adapter must thread the external
   * generic so multi-slice setups type correctly. The two-arg
   * `JobTypes<TInternal, TExternal>` return type makes this verifiable at the
   * fixture call site.
   */
  external: {
    buildWithExternalSlice: () => JobTypes<
      {
        "orders.place-order": {
          entry: true;
          input: { userId: string };
          output: undefined;
          continueWith: { typeName: "orders.confirm-order" };
          blockers: undefined;
        };
        "orders.confirm-order": {
          entry: undefined;
          input: { orderId: number };
          output: { confirmedAt: string };
          continueWith: undefined;
          blockers: readonly { typeName: "notifications.send-notification" }[];
        };
      },
      {
        "notifications.send-notification": {
          entry: true;
          input: { userId: string; message: string };
          output: { sentAt: string };
          continueWith: undefined;
          blockers: undefined;
        };
      }
    >;
  };
};

export type ValidationAdapterConformanceContext = Omit<ValidationConformanceFixture, "dispose">;

const expectJobTypeValidationError = (
  fn: () => unknown,
  expectedCode: JobTypeValidationError["code"],
  expectedTypeName: string,
): JobTypeValidationError => {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof JobTypeValidationError)) {
    const description =
      thrown === undefined
        ? "no throw"
        : thrown instanceof Error
          ? `${thrown.name}: ${thrown.message}`
          : JSON.stringify(thrown);
    throw new Error(`expected JobTypeValidationError, got ${description}`);
  }
  if (thrown.code !== expectedCode) {
    throw new Error(`expected code "${expectedCode}", got "${thrown.code}"`);
  }
  if (thrown.typeName !== expectedTypeName) {
    throw new Error(`expected typeName "${expectedTypeName}", got "${thrown.typeName}"`);
  }
  return thrown;
};

export const validationAdapterConformanceGroups: ConformanceGroup<ValidationAdapterConformanceContext>[] =
  [
    {
      name: "getTypeNames",
      cases: [
        {
          name: "returns all registered type names",
          run: async ({ basic }, expect) => {
            const jobTypes = basic.buildContinuationOnly();
            const names = jobTypes.getTypeNames();
            expect([...names].sort()).toEqual(["main", "next"]);
          },
        },
      ],
    },
    {
      name: "validateEntry",
      cases: [
        {
          name: "passes for entry types",
          run: async ({ basic }, expect) => {
            expect(() => {
              basic.buildEntry().validateEntry("main");
            }).not.toThrow();
          },
        },
        {
          name: "wraps non-entry as JobTypeValidationError(code=not_entry_point)",
          run: async ({ basic }) => {
            expectJobTypeValidationError(
              () => {
                basic.buildNonEntry().validateEntry("internal");
              },
              "not_entry_point",
              "internal",
            );
          },
        },
        {
          name: "wraps unknown type as JobTypeValidationError(code=not_entry_point)",
          run: async ({ basic }) => {
            expectJobTypeValidationError(
              () => {
                basic.buildEntry().validateEntry("unknown");
              },
              "not_entry_point",
              "unknown",
            );
          },
        },
      ],
    },
    {
      name: "parseInput",
      cases: [
        {
          name: "returns parsed value for valid input",
          run: async ({ basic }, expect) => {
            const result = basic.buildEntry().parseInput("main", { id: "abc" });
            expect(result).toEqual({ id: "abc" });
          },
        },
        {
          name: "wraps invalid input as JobTypeValidationError(code=invalid_input + cause + details)",
          run: async ({ basic }, expect) => {
            const error = expectJobTypeValidationError(
              () => basic.buildEntry().parseInput("main", { id: 123 }),
              "invalid_input",
              "main",
            );
            expect(error.cause).toBeDefined();
            expect((error.details as { input: unknown }).input).toEqual({ id: 123 });
          },
        },
      ],
    },
    {
      name: "parseOutput",
      cases: [
        {
          name: "returns parsed value for valid output",
          run: async ({ basic }, expect) => {
            const result = basic.buildEntry().parseOutput("main", { ok: true });
            expect(result).toEqual({ ok: true });
          },
        },
        {
          name: "wraps invalid output as JobTypeValidationError(code=invalid_output + cause + details)",
          run: async ({ basic }, expect) => {
            const error = expectJobTypeValidationError(
              () => basic.buildEntry().parseOutput("main", { ok: "yes" }),
              "invalid_output",
              "main",
            );
            expect(error.cause).toBeDefined();
            expect((error.details as { output: unknown }).output).toEqual({ ok: "yes" });
          },
        },
        {
          name: "wraps missing output schema as JobTypeValidationError(code=invalid_output)",
          run: async ({ basic }) => {
            expectJobTypeValidationError(
              () => basic.buildContinuationOnly().parseOutput("main", { whatever: true }),
              "invalid_output",
              "main",
            );
          },
        },
      ],
    },
    {
      name: "validateContinueWith",
      cases: [
        {
          name: "nominal: passes for valid name",
          run: async ({ continuations }, expect) => {
            expect(() => {
              continuations.buildNominal().validateContinueWith("step1", {
                typeName: "step2",
                input: { data: "x" },
              });
            }).not.toThrow();
          },
        },
        {
          name: "nominal: wraps invalid name as JobTypeValidationError(code=invalid_continuation)",
          run: async ({ continuations }) => {
            expectJobTypeValidationError(
              () => {
                continuations.buildNominal().validateContinueWith("step1", {
                  typeName: "step3",
                  input: {},
                });
              },
              "invalid_continuation",
              "step1",
            );
          },
        },
        {
          name: "structural: passes for matching shape",
          run: async ({ continuations }, expect) => {
            expect(() => {
              continuations.buildStructural().validateContinueWith("router", {
                typeName: "handler",
                input: { payload: "x" },
              });
            }).not.toThrow();
          },
        },
        {
          name: "structural: wraps non-matching shape as JobTypeValidationError(code=invalid_continuation)",
          run: async ({ continuations }) => {
            expectJobTypeValidationError(
              () => {
                continuations.buildStructural().validateContinueWith("router", {
                  typeName: "handler",
                  input: { wrongField: "x" },
                });
              },
              "invalid_continuation",
              "router",
            );
          },
        },
        {
          name: "wraps missing continueWith schema as JobTypeValidationError(code=invalid_continuation)",
          run: async ({ basic }) => {
            expectJobTypeValidationError(
              () => {
                basic
                  .buildEntry()
                  .validateContinueWith("main", { typeName: "anything", input: {} });
              },
              "invalid_continuation",
              "main",
            );
          },
        },
      ],
    },
    {
      name: "validateBlockers",
      cases: [
        {
          name: "nominal: passes for valid name",
          run: async ({ blockers }, expect) => {
            expect(() => {
              blockers
                .buildNominal()
                .validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
            }).not.toThrow();
          },
        },
        {
          name: "nominal: wraps invalid name as JobTypeValidationError(code=invalid_blockers)",
          run: async ({ blockers }) => {
            expectJobTypeValidationError(
              () => {
                blockers
                  .buildNominal()
                  .validateBlockers("main", [{ typeName: "wrong", input: {} }]);
              },
              "invalid_blockers",
              "main",
            );
          },
        },
        {
          name: "structural: passes for matching shape",
          run: async ({ blockers }, expect) => {
            expect(() => {
              blockers
                .buildStructural()
                .validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
            }).not.toThrow();
          },
        },
        {
          name: "structural: wraps non-matching shape as JobTypeValidationError(code=invalid_blockers)",
          run: async ({ blockers }) => {
            expectJobTypeValidationError(
              () => {
                blockers
                  .buildStructural()
                  .validateBlockers("main", [{ typeName: "auth", input: { wrong: "data" } }]);
              },
              "invalid_blockers",
              "main",
            );
          },
        },
        {
          name: "wraps missing blockers schema with non-empty list as JobTypeValidationError(code=invalid_blockers)",
          run: async ({ basic }) => {
            expectJobTypeValidationError(
              () => {
                basic.buildEntry().validateBlockers("main", [{ typeName: "anything", input: {} }]);
              },
              "invalid_blockers",
              "main",
            );
          },
        },
      ],
    },
    {
      name: "external slice",
      cases: [
        {
          name: "registry constructs and validates entries from main slice",
          run: async ({ external }, expect) => {
            const jobTypes = external.buildWithExternalSlice();
            expect(() => {
              jobTypes.validateEntry("orders.place-order");
            }).not.toThrow();
            const names = jobTypes.getTypeNames();
            expect([...names].sort()).toEqual(["orders.confirm-order", "orders.place-order"]);
          },
        },
      ],
    },
  ];
