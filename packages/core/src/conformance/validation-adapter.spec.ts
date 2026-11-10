import { describe, expect, it } from "vitest";

import type { BaseJobTypeDefinitions } from "../job-types/job-type.ts";
import { type JobTypes, createJobTypes } from "../job-types/job-types.ts";
import type { JobTypesDefinitions } from "../job-types/merge-job-types.ts";
import {
  type ValidationAdapterConformanceContext,
  validationAdapterConformanceCases,
} from "./validation-adapter.ts";

type FieldType = "string" | "number" | "boolean";
type FieldShape = Record<string, FieldType>;

const checkShape = (value: unknown, fields: FieldShape): Record<string, unknown> => {
  if (value === null || typeof value !== "object") throw new Error("not an object");
  const obj = value as Record<string, unknown>;
  for (const [key, fieldType] of Object.entries(fields)) {
    if (typeof obj[key] !== fieldType) {
      throw new Error(`${key}: expected ${fieldType}, got ${typeof obj[key]}`);
    }
  }
  return obj;
};

type ShapeCheckConfig = {
  typeNames: readonly string[];
  entryTypes: ReadonlySet<string>;
  inputs: Record<string, FieldShape>;
  outputs: Record<string, FieldShape | null>;
  continueWith: Record<string, ((target: { typeName: string; input: unknown }) => void) | null>;
  blockers: Record<
    string,
    ((blockers: readonly { typeName: string; input: unknown }[]) => void) | null
  >;
};

/**
 * A minimal "shape-check" adapter built directly on `createJobTypes`. Used to
 * verify the validation conformance runner end-to-end without pulling in a
 * userland schema library. Each method either returns the value or throws —
 * core's `createJobTypes` wraps thrown errors in `JobTypeValidationError`.
 */
const createShapeCheckJobTypes = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  const TExternalArg extends
    | JobTypes<BaseJobTypeDefinitions>
    | readonly JobTypes<BaseJobTypeDefinitions>[] = readonly [],
>(
  config: ShapeCheckConfig,
  externalDefinitions?: TExternalArg,
): JobTypes<TJobTypeDefinitions, JobTypesDefinitions<TExternalArg>> => {
  void externalDefinitions;
  type TExternalJobTypeDefinitions = JobTypesDefinitions<TExternalArg>;
  const knownTypes = new Set(config.typeNames);
  const checkKnown = (typeName: string): void => {
    if (!knownTypes.has(typeName)) throw new Error(`unknown type: ${typeName}`);
  };
  const checkInput = (typeName: string, input: unknown): unknown => {
    checkKnown(typeName);
    const shape = config.inputs[typeName];
    if (!shape) throw new Error(`no input shape for ${typeName}`);
    return checkShape(input, shape);
  };
  const checkOutput = (typeName: string, output: unknown): unknown => {
    checkKnown(typeName);
    const shape = config.outputs[typeName];
    if (!shape) throw new Error(`no output shape for ${typeName}`);
    return checkShape(output, shape);
  };
  return createJobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions>({
    getTypeNames: () => config.typeNames,
    validateEntry: (typeName) => {
      checkKnown(typeName);
      if (!config.entryTypes.has(typeName)) throw new Error(`not entry: ${typeName}`);
    },
    encodeInput: checkInput,
    decodeInput: checkInput,
    encodeOutput: checkOutput,
    decodeOutput: checkOutput,
    validateContinueWith: (typeName, target) => {
      checkKnown(typeName);
      const validator = config.continueWith[typeName];
      if (!validator) throw new Error(`no continueWith for ${typeName}`);
      validator(target);
    },
    validateBlockers: (typeName, blockers) => {
      checkKnown(typeName);
      const validator = config.blockers[typeName];
      if (!validator) {
        if (blockers.length > 0) throw new Error(`no blockers for ${typeName}`);
        return;
      }
      validator(blockers);
    },
  });
};

const buildPassingContext = (): ValidationAdapterConformanceContext => ({
  basic: {
    buildEntry: () =>
      createShapeCheckJobTypes({
        typeNames: ["main"],
        entryTypes: new Set(["main"]),
        inputs: { main: { id: "string" } },
        outputs: { main: { ok: "boolean" } },
        continueWith: { main: null },
        blockers: { main: null },
      }),
    buildNonEntry: () =>
      createShapeCheckJobTypes({
        typeNames: ["internal"],
        entryTypes: new Set(),
        inputs: { internal: { id: "string" } },
        outputs: { internal: { ok: "boolean" } },
        continueWith: { internal: null },
        blockers: { internal: null },
      }),
    buildContinuationOnly: () =>
      createShapeCheckJobTypes({
        typeNames: ["main", "next"],
        entryTypes: new Set(["main"]),
        inputs: { main: { id: "string" }, next: { data: "string" } },
        outputs: { main: null, next: { done: "boolean" } },
        continueWith: {
          main: (target) => {
            if (target.typeName !== "next") throw new Error("must be next");
          },
          next: null,
        },
        blockers: { main: null, next: null },
      }),
  },
  continuations: {
    buildNominal: () =>
      createShapeCheckJobTypes({
        typeNames: ["step1", "step2"],
        entryTypes: new Set(["step1"]),
        inputs: { step1: { id: "string" }, step2: {} },
        outputs: { step1: null, step2: { done: "boolean" } },
        continueWith: {
          step1: (target) => {
            if (target.typeName !== "step2") throw new Error("must be step2");
          },
          step2: null,
        },
        blockers: { step1: null, step2: null },
      }),
    buildStructural: () =>
      createShapeCheckJobTypes({
        typeNames: ["router", "handler"],
        entryTypes: new Set(["router"]),
        inputs: { router: { route: "string" }, handler: { payload: "string" } },
        outputs: { router: null, handler: { handled: "boolean" } },
        continueWith: {
          router: (target) => {
            checkShape(target.input, { payload: "string" });
          },
          handler: null,
        },
        blockers: { router: null, handler: null },
      }),
  },
  blockers: {
    buildNominal: () =>
      createShapeCheckJobTypes({
        typeNames: ["main", "auth"],
        entryTypes: new Set(["main", "auth"]),
        inputs: { main: { id: "string" }, auth: { token: "string" } },
        outputs: { main: { done: "boolean" }, auth: { userId: "string" } },
        continueWith: { main: null, auth: null },
        blockers: {
          main: (list) => {
            for (const blocker of list) {
              if (blocker.typeName !== "auth") throw new Error(`bad blocker ${blocker.typeName}`);
            }
          },
          auth: null,
        },
      }),
    buildStructural: () =>
      createShapeCheckJobTypes({
        typeNames: ["main", "auth"],
        entryTypes: new Set(["main", "auth"]),
        inputs: { main: { id: "string" }, auth: { token: "string" } },
        outputs: { main: { done: "boolean" }, auth: { userId: "string" } },
        continueWith: { main: null, auth: null },
        blockers: {
          main: (list) => {
            for (const blocker of list) {
              checkShape(blocker.input, { token: "string" });
            }
          },
          auth: null,
        },
      }),
  },
  external: {
    buildWithExternalSlice: () => {
      const notifications = createShapeCheckJobTypes<{
        "notifications.send-notification": {
          entry: true;
          input: { userId: string; message: string };
          output: { sentAt: string };
          continueWith: undefined;
          blockers: undefined;
        };
      }>({
        typeNames: ["notifications.send-notification"],
        entryTypes: new Set(["notifications.send-notification"]),
        inputs: {
          "notifications.send-notification": { userId: "string", message: "string" },
        },
        outputs: { "notifications.send-notification": { sentAt: "string" } },
        continueWith: { "notifications.send-notification": null },
        blockers: { "notifications.send-notification": null },
      });
      return createShapeCheckJobTypes(
        {
          typeNames: ["orders.place-order", "orders.confirm-order"],
          entryTypes: new Set(["orders.place-order"]),
          inputs: {
            "orders.place-order": { userId: "string" },
            "orders.confirm-order": { orderId: "number" },
          },
          outputs: {
            "orders.place-order": null,
            "orders.confirm-order": { confirmedAt: "string" },
          },
          continueWith: {
            "orders.place-order": (target) => {
              if (target.typeName !== "orders.confirm-order") throw new Error("bad");
            },
            "orders.confirm-order": null,
          },
          blockers: {
            "orders.place-order": null,
            "orders.confirm-order": (list) => {
              for (const blocker of list) {
                if (blocker.typeName !== "notifications.send-notification") {
                  throw new Error("bad");
                }
              }
            },
          },
        },
        notifications,
      );
    },
    buildWithExternalSlices: () => {
      const notifications = createShapeCheckJobTypes<{
        "notifications.send-notification": {
          entry: true;
          input: { userId: string; message: string };
          output: { sentAt: string };
          continueWith: undefined;
          blockers: undefined;
        };
      }>({
        typeNames: ["notifications.send-notification"],
        entryTypes: new Set(["notifications.send-notification"]),
        inputs: { "notifications.send-notification": { userId: "string", message: "string" } },
        outputs: { "notifications.send-notification": { sentAt: "string" } },
        continueWith: { "notifications.send-notification": null },
        blockers: { "notifications.send-notification": null },
      });
      const payments = createShapeCheckJobTypes<{
        "payments.charge": {
          entry: true;
          input: { amount: number };
          output: { receiptId: string };
          continueWith: undefined;
          blockers: undefined;
        };
      }>({
        typeNames: ["payments.charge"],
        entryTypes: new Set(["payments.charge"]),
        inputs: { "payments.charge": { amount: "number" } },
        outputs: { "payments.charge": { receiptId: "string" } },
        continueWith: { "payments.charge": null },
        blockers: { "payments.charge": null },
      });
      return createShapeCheckJobTypes(
        {
          typeNames: ["orders.place-order", "orders.confirm-order"],
          entryTypes: new Set(["orders.place-order"]),
          inputs: {
            "orders.place-order": { userId: "string" },
            "orders.confirm-order": { orderId: "number" },
          },
          outputs: {
            "orders.place-order": null,
            "orders.confirm-order": { confirmedAt: "string" },
          },
          continueWith: {
            "orders.place-order": (target) => {
              if (target.typeName !== "orders.confirm-order") throw new Error("bad");
            },
            "orders.confirm-order": null,
          },
          blockers: {
            "orders.place-order": null,
            "orders.confirm-order": (list) => {
              for (const blocker of list) {
                if (
                  blocker.typeName !== "notifications.send-notification" &&
                  blocker.typeName !== "payments.charge"
                ) {
                  throw new Error("bad");
                }
              }
            },
          },
        },
        [notifications, payments] as const,
      );
    },
  },
});

const buildBrokenEntryContext = (): ValidationAdapterConformanceContext => {
  const context = buildPassingContext();
  return {
    ...context,
    basic: {
      ...context.basic,
      buildEntry: () =>
        createShapeCheckJobTypes({
          typeNames: ["main"],
          entryTypes: new Set(),
          inputs: { main: { id: "string" } },
          outputs: { main: { ok: "boolean" } },
          continueWith: { main: null },
          blockers: { main: null },
        }),
    },
  };
};

describe("validationAdapterConformanceCases", () => {
  const context = buildPassingContext();

  for (const conformanceCase of validationAdapterConformanceCases) {
    it(`passes ${conformanceCase.title} for a correctly-implemented adapter`, async () => {
      await conformanceCase.run(context);
    });
  }

  it("fails a case when a builder violates the runtime contract", async () => {
    const context = buildBrokenEntryContext();
    const outcomes = await Promise.allSettled(
      validationAdapterConformanceCases.map(async (conformanceCase) =>
        conformanceCase.run(context),
      ),
    );

    expect(outcomes.some((outcome) => outcome.status === "rejected")).toBe(true);
  });
});
