import assert from "node:assert/strict";

import type { ConformanceGroup } from "../conformance/runner.ts";
import { JobTypeValidationError } from "../errors.ts";
import type { ValidationAdapterConformanceContext } from "./types.ts";

const assertJobTypeValidationError = (
  thrown: unknown,
  expectedCode: JobTypeValidationError["code"],
  expectedTypeName: string,
): JobTypeValidationError => {
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
  return assertJobTypeValidationError(thrown, expectedCode, expectedTypeName);
};

export const validationAdapterConformanceGroups: ConformanceGroup<ValidationAdapterConformanceContext>[] =
  [
    {
      name: "getTypeNames",
      cases: [
        {
          name: "returns all registered type names",
          run: async ({ basic }) => {
            const jobTypes = basic.buildContinuationOnly();
            const names = jobTypes.getTypeNames();
            assert.deepEqual([...names].sort(), ["main", "next"]);
          },
        },
      ],
    },
    {
      name: "validateEntry",
      cases: [
        {
          name: "passes for entry types",
          run: async ({ basic }) => {
            assert.doesNotThrow(() => {
              basic.buildEntry().validateEntry("main");
            });
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
      name: "encodeInput",
      cases: [
        {
          name: "returns encoded values for valid inputs",
          run: async ({ basic }) => {
            const result = basic.buildEntry().encodeInput("main", { id: "abc" });
            assert.deepEqual(result, { id: "abc" });
          },
        },
        {
          name: "wraps invalid input as JobTypeValidationError(code=invalid_input + cause)",
          run: async ({ basic }) => {
            const error = expectJobTypeValidationError(
              () => basic.buildEntry().encodeInput("main", { id: 123 }),
              "invalid_input",
              "main",
            );
            assert.notEqual(error.cause, undefined);
          },
        },
      ],
    },
    {
      name: "decodeInput",
      cases: [
        {
          name: "returns decoded values for valid inputs",
          run: async ({ basic }) => {
            const result = basic.buildEntry().decodeInput("main", { id: "abc" });
            assert.deepEqual(result, { id: "abc" });
          },
        },
        {
          name: "wraps invalid input as JobTypeValidationError(code=invalid_input + cause)",
          run: async ({ basic }) => {
            const error = expectJobTypeValidationError(
              () => basic.buildEntry().decodeInput("main", { id: 123 }),
              "invalid_input",
              "main",
            );
            assert.notEqual(error.cause, undefined);
          },
        },
      ],
    },
    {
      name: "encodeOutput",
      cases: [
        {
          name: "returns encoded values for valid outputs",
          run: async ({ basic }) => {
            const result = basic.buildEntry().encodeOutput("main", { ok: true });
            assert.deepEqual(result, { ok: true });
          },
        },
        {
          name: "wraps invalid output as JobTypeValidationError(code=invalid_output + cause)",
          run: async ({ basic }) => {
            const error = expectJobTypeValidationError(
              () => basic.buildEntry().encodeOutput("main", { ok: "yes" }),
              "invalid_output",
              "main",
            );
            assert.notEqual(error.cause, undefined);
          },
        },
        {
          name: "wraps missing output schema as JobTypeValidationError(code=invalid_output)",
          run: async ({ basic }) => {
            expectJobTypeValidationError(
              () => basic.buildContinuationOnly().encodeOutput("main", { whatever: true }),
              "invalid_output",
              "main",
            );
          },
        },
      ],
    },
    {
      name: "decodeOutput",
      cases: [
        {
          name: "returns decoded values for valid outputs",
          run: async ({ basic }) => {
            const result = basic.buildEntry().decodeOutput("main", { ok: true });
            assert.deepEqual(result, { ok: true });
          },
        },
        {
          name: "wraps invalid output as JobTypeValidationError(code=invalid_output + cause)",
          run: async ({ basic }) => {
            const error = expectJobTypeValidationError(
              () => basic.buildEntry().decodeOutput("main", { ok: "yes" }),
              "invalid_output",
              "main",
            );
            assert.notEqual(error.cause, undefined);
          },
        },
      ],
    },
    {
      name: "validateContinueWith",
      cases: [
        {
          name: "nominal: passes for valid name",
          run: async ({ continuations }) => {
            assert.doesNotThrow(() => {
              continuations
                .buildNominal()
                .validateContinueWith("step1", { typeName: "step2", input: { data: "x" } });
            });
          },
        },
        {
          name: "nominal: wraps invalid name as JobTypeValidationError(code=invalid_continuation)",
          run: async ({ continuations }) => {
            expectJobTypeValidationError(
              () => {
                continuations
                  .buildNominal()
                  .validateContinueWith("step1", { typeName: "step3", input: {} });
              },
              "invalid_continuation",
              "step1",
            );
          },
        },
        {
          name: "structural: passes for matching shape",
          run: async ({ continuations }) => {
            assert.doesNotThrow(() => {
              continuations
                .buildStructural()
                .validateContinueWith("router", { typeName: "handler", input: { payload: "x" } });
            });
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
          run: async ({ blockers }) => {
            assert.doesNotThrow(() => {
              blockers
                .buildNominal()
                .validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
            });
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
          run: async ({ blockers }) => {
            assert.doesNotThrow(() => {
              blockers
                .buildStructural()
                .validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
            });
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
          run: async ({ external }) => {
            const jobTypes = external.buildWithExternalSlice();
            assert.doesNotThrow(() => {
              jobTypes.validateEntry("orders.place-order");
            });
            const names = jobTypes.getTypeNames();
            assert.deepEqual([...names].sort(), ["orders.confirm-order", "orders.place-order"]);
          },
        },
        {
          name: "registry validates blockers referencing multiple external slices passed as an array",
          run: async ({ external }) => {
            const jobTypes = external.buildWithExternalSlices();
            assert.doesNotThrow(() => {
              jobTypes.validateBlockers("orders.confirm-order", [
                {
                  typeName: "notifications.send-notification",
                  input: { userId: "u1", message: "hi" },
                },
                { typeName: "payments.charge", input: { amount: 50 } },
              ]);
            });
          },
        },
      ],
    },
  ];
