import { describe, expect, it } from "vitest";

import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type JobTypes, createJobTypes } from "../entities/job-types.js";
import { ConformanceError } from "./runner.js";
import {
  type ValidationConformanceFixture,
  runValidationAdapterConformance,
} from "./validation-adapter.js";

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
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
>(
  config: ShapeCheckConfig,
  externalDefinitions?: JobTypes<TExternalJobTypeDefinitions>,
): JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions> => {
  void externalDefinitions;
  const knownTypes = new Set(config.typeNames);
  const checkKnown = (typeName: string): void => {
    if (!knownTypes.has(typeName)) throw new Error(`unknown type: ${typeName}`);
  };
  return createJobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions>({
    getTypeNames: () => config.typeNames,
    validateEntry: (typeName) => {
      checkKnown(typeName);
      if (!config.entryTypes.has(typeName)) throw new Error(`not entry: ${typeName}`);
    },
    parseInput: (typeName, input) => {
      checkKnown(typeName);
      const shape = config.inputs[typeName];
      if (!shape) throw new Error(`no input shape for ${typeName}`);
      return checkShape(input, shape);
    },
    parseOutput: (typeName, output) => {
      checkKnown(typeName);
      const shape = config.outputs[typeName];
      if (!shape) throw new Error(`no output for ${typeName}`);
      return checkShape(output, shape);
    },
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

const buildPassingFixture = (): ValidationConformanceFixture => ({
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
  },
});

describe("runValidationAdapterConformance", () => {
  it("returns a passing report for a correctly-implemented adapter", async () => {
    const report = await runValidationAdapterConformance(async () => buildPassingFixture());

    expect(report.failed).toBe(0);
    expect(report.passed).toBe(report.total);
    expect(report.total).toBeGreaterThan(0);
  });

  it("invokes onResult once per case", async () => {
    const seen: string[] = [];

    const report = await runValidationAdapterConformance(async () => buildPassingFixture(), {
      onResult: (result) => {
        seen.push(result.name);
      },
    });

    expect(seen).toHaveLength(report.total);
  });

  it("invokes dispose after the run completes", async () => {
    let disposed = false;

    await runValidationAdapterConformance(async () => ({
      ...buildPassingFixture(),
      dispose: async () => {
        disposed = true;
      },
    }));

    expect(disposed).toBe(true);
  });

  it("throws ConformanceError when a builder violates the runtime contract", async () => {
    await expect(
      runValidationAdapterConformance(async () => {
        const fixture = buildPassingFixture();
        return {
          ...fixture,
          basic: {
            ...fixture.basic,
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
      }),
    ).rejects.toThrow(ConformanceError);
  });

  it("disposes even when cases fail", async () => {
    let disposed = false;

    await runValidationAdapterConformance(async () => {
      const fixture = buildPassingFixture();
      return {
        ...fixture,
        basic: {
          ...fixture.basic,
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
        dispose: async () => {
          disposed = true;
        },
      };
    }).catch(() => {});

    expect(disposed).toBe(true);
  });
});
