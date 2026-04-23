import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { defineJobTypes } from "./entities/define-job-types.js";
import { type BaseJobTypeDefinitions } from "./entities/job-type.js";
import {
  type JobTypesOptions,
  type JobTypeDefinitions,
  createJobTypes,
} from "./entities/job-types.js";
import {
  type JobTypeContinuation,
  type JobTypeEntryNames,
  type JobTypeProperty,
} from "./entities/job-types.resolvers.js";
import { mergeJobTypes } from "./entities/merge-job-types.js";
import { DuplicateJobTypeError, JobTypeValidationError, UnknownJobTypeError } from "./errors.js";

const createValidatedRegistry = <T extends BaseJobTypeDefinitions>(typeNames: string[]) => {
  const knownTypes = new Set(typeNames);
  return createJobTypes<T>({
    getTypeNames: () => typeNames,
    validateEntry: (typeName) => {
      if (!knownTypes.has(typeName)) throw new Error(`Unknown type: ${typeName}`);
    },
    parseInput: (typeName, input) => {
      if (!knownTypes.has(typeName)) throw new Error(`Unknown type: ${typeName}`);
      return input;
    },
    parseOutput: (typeName, output) => {
      if (!knownTypes.has(typeName)) throw new Error(`Unknown type: ${typeName}`);
      return output;
    },
    validateContinueWith: (typeName) => {
      if (!knownTypes.has(typeName)) throw new Error(`Unknown type: ${typeName}`);
    },
    validateBlockers: (typeName) => {
      if (!knownTypes.has(typeName)) throw new Error(`Unknown type: ${typeName}`);
    },
  });
};

describe("mergeJobTypes", () => {
  describe("noop registries", () => {
    it("merges two noop registries", () => {
      const a = defineJobTypes<{
        "job-a": { entry: true; input: { id: string }; output: string };
      }>();
      const b = defineJobTypes<{
        "job-b": { entry: true; input: { count: number }; output: number };
      }>();

      const mergedJobTypes = mergeJobTypes([a, b]);

      mergedJobTypes.validateEntry("job-a");
      mergedJobTypes.validateEntry("job-b");
      expect(mergedJobTypes.parseInput("job-a", { id: "test" })).toEqual({ id: "test" });
      expect(mergedJobTypes.parseInput("job-b", { count: 42 })).toEqual({ count: 42 });
    });

    it("merges three noop registries", () => {
      const a = defineJobTypes<{
        "job-a": { entry: true; input: string; output: string };
      }>();
      const b = defineJobTypes<{
        "job-b": { entry: true; input: number; output: number };
      }>();
      const c = defineJobTypes<{
        "job-c": { entry: true; input: boolean; output: boolean };
      }>();

      const mergedJobTypes = mergeJobTypes([a, b, c]);

      mergedJobTypes.validateEntry("job-a");
      mergedJobTypes.validateEntry("job-b");
      mergedJobTypes.validateEntry("job-c");
    });

    it("returns passthrough behavior", () => {
      const a = defineJobTypes<{
        "job-a": { entry: true; input: { id: string }; output: string };
      }>();
      const b = defineJobTypes<{
        "job-b": { entry: true; input: { count: number }; output: number };
      }>();

      const mergedJobTypes = mergeJobTypes([a, b]);
      const input = { id: "test" };

      expect(mergedJobTypes.parseInput("job-a", input)).toBe(input);
      expect(mergedJobTypes.parseOutput("job-a", "result")).toBe("result");
      expect(() => {
        mergedJobTypes.validateContinueWith("job-a", { typeName: "job-b", input: {} });
      }).not.toThrow();
      expect(() => {
        mergedJobTypes.validateBlockers("job-a", [{ typeName: "job-b", input: {} }]);
      }).not.toThrow();
    });

    it("detects duplicate type names at compile time", () => {
      const a = defineJobTypes<{
        "job-a": { entry: true; input: string; output: string };
      }>();
      const b = defineJobTypes<{
        "job-a": { entry: true; input: number; output: number };
      }>();

      // @ts-expect-error — duplicate "job-a" detected at compile time
      mergeJobTypes([a, b]);
    });

    it("detects duplicates across three registries at compile time", () => {
      const a = defineJobTypes<{
        "job-a": { entry: true; input: string; output: string };
      }>();
      const b = defineJobTypes<{
        "job-b": { entry: true; input: number; output: number };
      }>();
      const c = defineJobTypes<{
        "job-a": { entry: true; input: boolean; output: boolean };
      }>();

      // @ts-expect-error — "job-a" duplicated between registries a and c
      mergeJobTypes([a, b, c]);
    });

    it("merges a registry with no types alongside a typed registry", () => {
      const empty = defineJobTypes<Record<never, never>>();
      const typed = defineJobTypes<{
        "job-a": { entry: true; input: string; output: string };
      }>();

      const mergedJobTypes = mergeJobTypes([empty, typed]);

      mergedJobTypes.validateEntry("job-a");
      expect(mergedJobTypes.parseInput("job-a", "hello")).toBe("hello");
    });

    it("preserves phantom type information", () => {
      const a = defineJobTypes<{
        "create-order": { entry: true; input: { userId: string }; output: { orderId: string } };
      }>();
      const b = defineJobTypes<{
        "send-email": { entry: true; input: { to: string }; output: { sent: boolean } };
      }>();

      const mergedJobTypes = mergeJobTypes([a, b]);

      type MergedDefs = JobTypeDefinitions<typeof mergedJobTypes>;
      expectTypeOf<JobTypeProperty<MergedDefs, "create-order", "input">>().toEqualTypeOf<{
        userId: string;
      }>();
      expectTypeOf<JobTypeProperty<MergedDefs, "send-email", "input">>().toEqualTypeOf<{
        to: string;
      }>();
    });

    it("preserves type information from each slice", () => {
      const a = defineJobTypes<{
        "create-order": {
          entry: true;
          input: { userId: string };
          continueWith: { typeName: "fulfill-order" };
        };
        "fulfill-order": {
          input: { orderId: string };
          output: { shipped: boolean };
        };
      }>();
      const b = defineJobTypes<{
        "send-email": { entry: true; input: { to: string }; output: { sent: boolean } };
      }>();

      const mergedJobTypes = mergeJobTypes([a, b]);

      type Defs = JobTypeDefinitions<typeof mergedJobTypes>;
      expectTypeOf<JobTypeProperty<Defs, "create-order", "input">>().toEqualTypeOf<{
        userId: string;
      }>();
      expectTypeOf<JobTypeEntryNames<Defs>>().toEqualTypeOf<"create-order" | "send-email">();
      expectTypeOf<JobTypeContinuation<Defs, "create-order">>().toEqualTypeOf<"fulfill-order">();
      expectTypeOf<JobTypeProperty<Defs, "fulfill-order", "input">>().toEqualTypeOf<{
        orderId: string;
      }>();
      expectTypeOf<JobTypeProperty<Defs, "fulfill-order", "output">>().toEqualTypeOf<{
        shipped: boolean;
      }>();
      expectTypeOf<JobTypeProperty<Defs, "send-email", "input">>().toEqualTypeOf<{
        to: string;
      }>();
    });
  });

  describe("validated registries", () => {
    it("delegates to the correct source registry", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypes = mergeJobTypes([a, b]);

      mergedJobTypes.validateEntry("job-a");
      mergedJobTypes.validateEntry("job-b");
      expect(mergedJobTypes.parseInput("job-a", "hello")).toBe("hello");
      expect(mergedJobTypes.parseInput("job-b", 42)).toBe(42);
    });

    it("delegates parseOutput to the correct source registry", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypes = mergeJobTypes([a, b]);

      expect(mergedJobTypes.parseOutput("job-a", "result")).toBe("result");
      expect(mergedJobTypes.parseOutput("job-b", 99)).toBe(99);
    });

    it("returns type names from all validated registries", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypes = mergeJobTypes([a, b]);

      expect(mergedJobTypes.getTypeNames()).toEqual(expect.arrayContaining(["job-a", "job-b"]));
      expect(mergedJobTypes.getTypeNames()).toHaveLength(2);
    });

    it("merges a validated registry with no types alongside a typed registry", () => {
      type TypesA = Record<never, never>;
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>([]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypes = mergeJobTypes([a, b]);

      expect(mergedJobTypes.getTypeNames()).toEqual(["job-b"]);
      mergedJobTypes.validateEntry("job-b");
    });

    it("throws UnknownJobTypeError for unknown type when all registries are validated", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypes = mergeJobTypes([a, b]);

      expect(() => {
        mergedJobTypes.validateEntry("job-unknown");
      }).toThrow(UnknownJobTypeError);
    });

    it("UnknownJobTypeError carries the type name and registered names", () => {
      expect.assertions(3);
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypes = mergeJobTypes([a, b]);

      try {
        mergedJobTypes.parseInput("job-unknown", { x: 1 });
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownJobTypeError);
        const unknownError = error as UnknownJobTypeError;
        expect(unknownError.typeName).toBe("job-unknown");
        expect([...unknownError.registeredTypeNames].sort()).toEqual(["job-a", "job-b"]);
      }
    });

    it("UnknownJobTypeError fires across every routed method", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };
      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypes = mergeJobTypes([a, b]);

      const target = { typeName: "job-a", input: "x" };
      expect(() => {
        mergedJobTypes.validateEntry("missing");
      }).toThrow(UnknownJobTypeError);
      expect(() => mergedJobTypes.parseInput("missing", {})).toThrow(UnknownJobTypeError);
      expect(() => mergedJobTypes.parseOutput("missing", {})).toThrow(UnknownJobTypeError);
      expect(() => {
        mergedJobTypes.validateContinueWith("missing", target);
      }).toThrow(UnknownJobTypeError);
      expect(() => {
        mergedJobTypes.validateBlockers("missing", [target]);
      }).toThrow(UnknownJobTypeError);
    });

    it("delegates validateContinueWith and validateBlockers", () => {
      const configA: JobTypesOptions = {
        getTypeNames: () => ["job-a"],
        validateEntry: vi.fn(),
        parseInput: vi.fn((_, input) => input),
        parseOutput: vi.fn((_, output) => output),
        validateContinueWith: vi.fn((typeName) => {
          if (typeName !== "job-a") throw new Error("unknown");
        }),
        validateBlockers: vi.fn((typeName) => {
          if (typeName !== "job-a") throw new Error("unknown");
        }),
      };
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createJobTypes<TypesA>(configA);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypes = mergeJobTypes([a, b]);
      const target = { typeName: "job-b", input: 42 };

      mergedJobTypes.validateContinueWith("job-a", target);
      expect(configA.validateContinueWith).toHaveBeenCalledWith("job-a", target);

      mergedJobTypes.validateBlockers("job-a", [target]);
      expect(configA.validateBlockers).toHaveBeenCalledWith("job-a", [target]);
    });

    it("throws DuplicateJobTypeError for overlapping type names at runtime", () => {
      type TypesA = { "shared-job": { entry: true; input: string; output: string } };
      type TypesB = { "shared-job": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["shared-job"]);
      const b = createValidatedRegistry<TypesB>(["shared-job"]);

      expect(() => {
        // @ts-expect-error — also detected at compile time
        mergeJobTypes([a, b]);
      }).toThrow(DuplicateJobTypeError);
    });

    it("includes duplicate type names in the error", () => {
      expect.assertions(2);

      type TypesA = {
        "job-a": { entry: true; input: string; output: string };
        overlap: { entry: true; input: string; output: string };
      };
      type TypesB = {
        "job-b": { entry: true; input: number; output: number };
        overlap: { entry: true; input: number; output: number };
      };

      const a = createValidatedRegistry<TypesA>(["job-a", "overlap"]);
      const b = createValidatedRegistry<TypesB>(["job-b", "overlap"]);

      try {
        // @ts-expect-error — duplicate "overlap"
        mergeJobTypes([a, b]);
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicateJobTypeError);
        expect((error as DuplicateJobTypeError).duplicateTypeNames).toEqual(["overlap"]);
      }
    });

    it("detects duplicates across three validated registries at runtime", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };
      type TypesC = { "job-a": { entry: true; input: boolean; output: boolean } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);
      const c = createValidatedRegistry<TypesC>(["job-a"]);

      expect(() => {
        // @ts-expect-error — "job-a" duplicated between registries a and c
        mergeJobTypes([a, b, c]);
      }).toThrow(DuplicateJobTypeError);
    });

    it("propagates validation errors without swallowing them", () => {
      type TypesA = { "job-a": { entry: true; input: { id: string }; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createJobTypes<TypesA>({
        getTypeNames: () => ["job-a"],
        validateEntry: () => {},
        parseInput: (typeName, input) => {
          if (typeName === "job-a" && typeof (input as any).id !== "string") {
            throw new Error("id must be a string");
          }
          return input;
        },
        parseOutput: (_, output) => output,
        validateContinueWith: () => {},
        validateBlockers: () => {},
      });
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypes = mergeJobTypes([a, b]);

      expect(() => {
        mergedJobTypes.parseInput("job-a", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("cross-slice external references", () => {
    it("allows cross-slice blocker references after merging", () => {
      const notifications = defineJobTypes<{
        "notifications.send": {
          entry: true;
          input: { userId: string; message: string };
          output: { sentAt: string };
        };
      }>();

      const orders = defineJobTypes<
        {
          "orders.create": {
            entry: true;
            input: { userId: string };
            output: { orderId: string };
            blockers: [{ typeName: "notifications.send" }];
          };
        },
        JobTypeDefinitions<typeof notifications>
      >();

      const mergedJobTypes = mergeJobTypes([notifications, orders]);

      type MergedDefs = JobTypeDefinitions<typeof mergedJobTypes>;
      expectTypeOf<JobTypeProperty<MergedDefs, "notifications.send", "input">>().toExtend<{
        userId: string;
      }>();
      expectTypeOf<JobTypeProperty<MergedDefs, "orders.create", "input">>().toExtend<{
        userId: string;
      }>();

      mergedJobTypes.validateEntry("notifications.send");
      mergedJobTypes.validateEntry("orders.create");
    });
  });

  describe("mixed noop + validated registries", () => {
    it("validates types from validated registry, passes through noop types", () => {
      const noop = defineJobTypes<{
        "noop-job": { entry: true; input: { id: string }; output: string };
      }>();

      let validateEntryCalled = false;
      const validated = createJobTypes<{
        "validated-job": { entry: true; input: { name: string }; output: number };
      }>({
        getTypeNames: () => ["validated-job"],
        validateEntry: (typeName) => {
          if (typeName !== "validated-job") throw new Error(`Unknown: ${typeName}`);
          validateEntryCalled = true;
        },
        parseInput: (typeName, input) => {
          if (typeName !== "validated-job") throw new Error(`Unknown: ${typeName}`);
          return input;
        },
        parseOutput: (typeName, output) => {
          if (typeName !== "validated-job") throw new Error(`Unknown: ${typeName}`);
          return output;
        },
        validateContinueWith: (typeName) => {
          if (typeName !== "validated-job") throw new Error(`Unknown: ${typeName}`);
        },
        validateBlockers: (typeName) => {
          if (typeName !== "validated-job") throw new Error(`Unknown: ${typeName}`);
        },
      });

      const mergedJobTypes = mergeJobTypes([noop, validated]);

      mergedJobTypes.validateEntry("validated-job");
      expect(validateEntryCalled).toBe(true);

      mergedJobTypes.validateEntry("noop-job");
      expect(mergedJobTypes.parseInput("noop-job", { id: "test" })).toEqual({ id: "test" });
    });

    it("returns only validated registry type names from getTypeNames", () => {
      const noop = defineJobTypes<{
        "noop-job": { entry: true; input: string; output: string };
      }>();
      const validated = createValidatedRegistry<{
        "validated-job": { entry: true; input: number; output: number };
      }>(["validated-job"]);

      const mergedJobTypes = mergeJobTypes([noop, validated]);

      expect(mergedJobTypes.getTypeNames()).toEqual(["validated-job"]);
    });

    it("passes through parseInput for noop types in mixed mode", () => {
      const noop = defineJobTypes<{
        "noop-job": { entry: true; input: { id: string }; output: string };
      }>();
      const validated = createValidatedRegistry<{
        "validated-job": { entry: true; input: number; output: number };
      }>(["validated-job"]);

      const mergedJobTypes = mergeJobTypes([noop, validated]);
      const input = { id: "test" };

      expect(mergedJobTypes.parseInput("noop-job", input)).toBe(input);
      expect(mergedJobTypes.parseInput("validated-job", 42)).toBe(42);
    });
  });

  describe("2-level merge (merge of merges)", () => {
    it("preserves type information through nested noop merges", () => {
      const a = defineJobTypes<{
        "slice-a": {
          entry: true;
          input: { a: string };
          continueWith: { typeName: "slice-a2" };
        };
        "slice-a2": { input: { x: number }; output: { doneA: boolean } };
      }>();
      const b = defineJobTypes<{
        "slice-b": { entry: true; input: { b: number }; output: { doneB: boolean } };
      }>();
      const c = defineJobTypes<{
        "slice-c": { entry: true; input: { c: boolean }; output: { doneC: string } };
      }>();

      const ab = mergeJobTypes([a, b]);
      const mergedJobTypes = mergeJobTypes([ab, c]);

      type Defs = JobTypeDefinitions<typeof mergedJobTypes>;
      expectTypeOf<JobTypeEntryNames<Defs>>().toEqualTypeOf<"slice-a" | "slice-b" | "slice-c">();
      expectTypeOf<JobTypeContinuation<Defs, "slice-a">>().toEqualTypeOf<"slice-a2">();
      expectTypeOf<JobTypeProperty<Defs, "slice-a2", "input">>().toEqualTypeOf<{
        x: number;
      }>();
      expectTypeOf<JobTypeProperty<Defs, "slice-b", "input">>().toEqualTypeOf<{
        b: number;
      }>();
      expectTypeOf<JobTypeProperty<Defs, "slice-c", "input">>().toEqualTypeOf<{
        c: boolean;
      }>();

      mergedJobTypes.validateEntry("slice-a");
      mergedJobTypes.validateEntry("slice-b");
      mergedJobTypes.validateEntry("slice-c");
    });

    it("preserves type information through nested validated merges", () => {
      type TypesA = { "job-a": { entry: true; input: { a: string }; output: string } };
      type TypesB = { "job-b": { entry: true; input: { b: number }; output: number } };
      type TypesC = { "job-c": { entry: true; input: { c: boolean }; output: boolean } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);
      const c = createValidatedRegistry<TypesC>(["job-c"]);

      const ab = mergeJobTypes([a, b]);
      const mergedJobTypes = mergeJobTypes([ab, c]);

      type Defs = JobTypeDefinitions<typeof mergedJobTypes>;
      expectTypeOf<JobTypeProperty<Defs, "job-a", "input">>().toEqualTypeOf<{
        a: string;
      }>();
      expectTypeOf<JobTypeProperty<Defs, "job-b", "input">>().toEqualTypeOf<{
        b: number;
      }>();
      expectTypeOf<JobTypeProperty<Defs, "job-c", "input">>().toEqualTypeOf<{
        c: boolean;
      }>();

      expect(mergedJobTypes.getTypeNames()).toEqual(
        expect.arrayContaining(["job-a", "job-b", "job-c"]),
      );
      expect(mergedJobTypes.getTypeNames()).toHaveLength(3);
      mergedJobTypes.validateEntry("job-a");
      mergedJobTypes.validateEntry("job-b");
      mergedJobTypes.validateEntry("job-c");
    });

    it("detects duplicates across nested merges at compile time", () => {
      const a = defineJobTypes<{
        shared: { entry: true; input: string; output: string };
      }>();
      const b = defineJobTypes<{
        other: { entry: true; input: number; output: number };
      }>();
      const c = defineJobTypes<{
        shared: { entry: true; input: boolean; output: boolean };
      }>();

      const ab = mergeJobTypes([a, b]);

      // @ts-expect-error — "shared" duplicated between ab and c
      mergeJobTypes([ab, c]);
    });
  });
});
