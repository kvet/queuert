import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { DuplicateJobTypeError, JobTypeValidationError } from "../errors.js";
import { defineJobTypeRegistry } from "./define-job-type-registry.js";
import {
  type JobTypeRegistryConfig,
  type JobTypeRegistryDefinitions,
  createJobTypeRegistry,
} from "./job-type-registry.js";
import {
  type JobTypeContinuation,
  type JobTypeEntryNames,
  type JobTypeProperty,
} from "./job-type-registry.resolvers.js";
import { type BaseJobTypeDefinitions } from "./job-type.js";
import { mergeJobTypeRegistries } from "./merge-job-type-registries.js";

const createValidatedRegistry = <T extends BaseJobTypeDefinitions>(typeNames: string[]) => {
  const knownTypes = new Set(typeNames);
  return createJobTypeRegistry<T>({
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

describe("mergeJobTypeRegistries", () => {
  describe("noop registries", () => {
    it("merges two noop registries", () => {
      const a = defineJobTypeRegistry<{
        "job-a": { entry: true; input: { id: string }; output: string };
      }>();
      const b = defineJobTypeRegistry<{
        "job-b": { entry: true; input: { count: number }; output: number };
      }>();

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });

      mergedJobTypeRegistry.validateEntry("job-a");
      mergedJobTypeRegistry.validateEntry("job-b");
      expect(mergedJobTypeRegistry.parseInput("job-a", { id: "test" })).toEqual({ id: "test" });
      expect(mergedJobTypeRegistry.parseInput("job-b", { count: 42 })).toEqual({ count: 42 });
    });

    it("merges three noop registries", () => {
      const a = defineJobTypeRegistry<{
        "job-a": { entry: true; input: string; output: string };
      }>();
      const b = defineJobTypeRegistry<{
        "job-b": { entry: true; input: number; output: number };
      }>();
      const c = defineJobTypeRegistry<{
        "job-c": { entry: true; input: boolean; output: boolean };
      }>();

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b, c] });

      mergedJobTypeRegistry.validateEntry("job-a");
      mergedJobTypeRegistry.validateEntry("job-b");
      mergedJobTypeRegistry.validateEntry("job-c");
    });

    it("returns passthrough behavior", () => {
      const a = defineJobTypeRegistry<{
        "job-a": { entry: true; input: { id: string }; output: string };
      }>();
      const b = defineJobTypeRegistry<{
        "job-b": { entry: true; input: { count: number }; output: number };
      }>();

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });
      const input = { id: "test" };

      expect(mergedJobTypeRegistry.parseInput("job-a", input)).toBe(input);
      expect(mergedJobTypeRegistry.parseOutput("job-a", "result")).toBe("result");
      expect(() => {
        mergedJobTypeRegistry.validateContinueWith("job-a", { typeName: "job-b", input: {} });
      }).not.toThrow();
      expect(() => {
        mergedJobTypeRegistry.validateBlockers("job-a", [{ typeName: "job-b", input: {} }]);
      }).not.toThrow();
    });

    it("detects duplicate type names at compile time", () => {
      const a = defineJobTypeRegistry<{
        "job-a": { entry: true; input: string; output: string };
      }>();
      const b = defineJobTypeRegistry<{
        "job-a": { entry: true; input: number; output: number };
      }>();

      // @ts-expect-error — duplicate "job-a" detected at compile time
      mergeJobTypeRegistries({ slices: [a, b] });
    });

    it("detects duplicates across three registries at compile time", () => {
      const a = defineJobTypeRegistry<{
        "job-a": { entry: true; input: string; output: string };
      }>();
      const b = defineJobTypeRegistry<{
        "job-b": { entry: true; input: number; output: number };
      }>();
      const c = defineJobTypeRegistry<{
        "job-a": { entry: true; input: boolean; output: boolean };
      }>();

      // @ts-expect-error — "job-a" duplicated between registries a and c
      mergeJobTypeRegistries({ slices: [a, b, c] });
    });

    it("merges a registry with no types alongside a typed registry", () => {
      const empty = defineJobTypeRegistry<Record<never, never>>();
      const typed = defineJobTypeRegistry<{
        "job-a": { entry: true; input: string; output: string };
      }>();

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [empty, typed] });

      mergedJobTypeRegistry.validateEntry("job-a");
      expect(mergedJobTypeRegistry.parseInput("job-a", "hello")).toBe("hello");
    });

    it("preserves phantom type information", () => {
      const a = defineJobTypeRegistry<{
        "create-order": { entry: true; input: { userId: string }; output: { orderId: string } };
      }>();
      const b = defineJobTypeRegistry<{
        "send-email": { entry: true; input: { to: string }; output: { sent: boolean } };
      }>();

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });

      type MergedDefs = JobTypeRegistryDefinitions<typeof mergedJobTypeRegistry>;
      expectTypeOf<JobTypeProperty<MergedDefs, "create-order", "input">>().toEqualTypeOf<{
        userId: string;
      }>();
      expectTypeOf<JobTypeProperty<MergedDefs, "send-email", "input">>().toEqualTypeOf<{
        to: string;
      }>();
    });

    it("preserves type information from each slice", () => {
      const a = defineJobTypeRegistry<{
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
      const b = defineJobTypeRegistry<{
        "send-email": { entry: true; input: { to: string }; output: { sent: boolean } };
      }>();

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });

      type Defs = JobTypeRegistryDefinitions<typeof mergedJobTypeRegistry>;
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

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });

      mergedJobTypeRegistry.validateEntry("job-a");
      mergedJobTypeRegistry.validateEntry("job-b");
      expect(mergedJobTypeRegistry.parseInput("job-a", "hello")).toBe("hello");
      expect(mergedJobTypeRegistry.parseInput("job-b", 42)).toBe(42);
    });

    it("delegates parseOutput to the correct source registry", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });

      expect(mergedJobTypeRegistry.parseOutput("job-a", "result")).toBe("result");
      expect(mergedJobTypeRegistry.parseOutput("job-b", 99)).toBe(99);
    });

    it("returns type names from all validated registries", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });

      expect(mergedJobTypeRegistry.getTypeNames()).toEqual(
        expect.arrayContaining(["job-a", "job-b"]),
      );
      expect(mergedJobTypeRegistry.getTypeNames()).toHaveLength(2);
    });

    it("merges a validated registry with no types alongside a typed registry", () => {
      type TypesA = Record<never, never>;
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>([]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });

      expect(mergedJobTypeRegistry.getTypeNames()).toEqual(["job-b"]);
      mergedJobTypeRegistry.validateEntry("job-b");
    });

    it("throws for unknown type when all registries are validated", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });

      expect(() => {
        mergedJobTypeRegistry.validateEntry("job-unknown");
      }).toThrow(JobTypeValidationError);
    });

    it("delegates validateContinueWith and validateBlockers", () => {
      const configA: JobTypeRegistryConfig = {
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

      const a = createJobTypeRegistry<TypesA>(configA);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });
      const target = { typeName: "job-b", input: 42 };

      mergedJobTypeRegistry.validateContinueWith("job-a", target);
      expect(configA.validateContinueWith).toHaveBeenCalledWith("job-a", target);

      mergedJobTypeRegistry.validateBlockers("job-a", [target]);
      expect(configA.validateBlockers).toHaveBeenCalledWith("job-a", [target]);
    });

    it("throws DuplicateJobTypeError for overlapping type names at runtime", () => {
      type TypesA = { "shared-job": { entry: true; input: string; output: string } };
      type TypesB = { "shared-job": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["shared-job"]);
      const b = createValidatedRegistry<TypesB>(["shared-job"]);

      expect(() => {
        // @ts-expect-error — also detected at compile time
        mergeJobTypeRegistries({ slices: [a, b] });
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
        mergeJobTypeRegistries({ slices: [a, b] });
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
        mergeJobTypeRegistries({ slices: [a, b, c] });
      }).toThrow(DuplicateJobTypeError);
    });

    it("propagates validation errors without swallowing them", () => {
      type TypesA = { "job-a": { entry: true; input: { id: string }; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createJobTypeRegistry<TypesA>({
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

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [a, b] });

      expect(() => {
        mergedJobTypeRegistry.parseInput("job-a", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("cross-slice external references", () => {
    it("allows cross-slice blocker references after merging", () => {
      const notifications = defineJobTypeRegistry<{
        "notifications.send": {
          entry: true;
          input: { userId: string; message: string };
          output: { sentAt: string };
        };
      }>();

      const orders = defineJobTypeRegistry<
        {
          "orders.create": {
            entry: true;
            input: { userId: string };
            output: { orderId: string };
            blockers: [{ typeName: "notifications.send" }];
          };
        },
        JobTypeRegistryDefinitions<typeof notifications>
      >();

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [notifications, orders] });

      type MergedDefs = JobTypeRegistryDefinitions<typeof mergedJobTypeRegistry>;
      expectTypeOf<JobTypeProperty<MergedDefs, "notifications.send", "input">>().toExtend<{
        userId: string;
      }>();
      expectTypeOf<JobTypeProperty<MergedDefs, "orders.create", "input">>().toExtend<{
        userId: string;
      }>();

      mergedJobTypeRegistry.validateEntry("notifications.send");
      mergedJobTypeRegistry.validateEntry("orders.create");
    });
  });

  describe("mixed noop + validated registries", () => {
    it("validates types from validated registry, passes through noop types", () => {
      const noop = defineJobTypeRegistry<{
        "noop-job": { entry: true; input: { id: string }; output: string };
      }>();

      let validateEntryCalled = false;
      const validated = createJobTypeRegistry<{
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

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [noop, validated] });

      mergedJobTypeRegistry.validateEntry("validated-job");
      expect(validateEntryCalled).toBe(true);

      mergedJobTypeRegistry.validateEntry("noop-job");
      expect(mergedJobTypeRegistry.parseInput("noop-job", { id: "test" })).toEqual({ id: "test" });
    });

    it("returns only validated registry type names from getTypeNames", () => {
      const noop = defineJobTypeRegistry<{
        "noop-job": { entry: true; input: string; output: string };
      }>();
      const validated = createValidatedRegistry<{
        "validated-job": { entry: true; input: number; output: number };
      }>(["validated-job"]);

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [noop, validated] });

      expect(mergedJobTypeRegistry.getTypeNames()).toEqual(["validated-job"]);
    });

    it("passes through parseInput for noop types in mixed mode", () => {
      const noop = defineJobTypeRegistry<{
        "noop-job": { entry: true; input: { id: string }; output: string };
      }>();
      const validated = createValidatedRegistry<{
        "validated-job": { entry: true; input: number; output: number };
      }>(["validated-job"]);

      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [noop, validated] });
      const input = { id: "test" };

      expect(mergedJobTypeRegistry.parseInput("noop-job", input)).toBe(input);
      expect(mergedJobTypeRegistry.parseInput("validated-job", 42)).toBe(42);
    });
  });

  describe("2-level merge (merge of merges)", () => {
    it("preserves type information through nested noop merges", () => {
      const a = defineJobTypeRegistry<{
        "slice-a": {
          entry: true;
          input: { a: string };
          continueWith: { typeName: "slice-a2" };
        };
        "slice-a2": { input: { x: number }; output: { doneA: boolean } };
      }>();
      const b = defineJobTypeRegistry<{
        "slice-b": { entry: true; input: { b: number }; output: { doneB: boolean } };
      }>();
      const c = defineJobTypeRegistry<{
        "slice-c": { entry: true; input: { c: boolean }; output: { doneC: string } };
      }>();

      const ab = mergeJobTypeRegistries({ slices: [a, b] });
      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [ab, c] });

      type Defs = JobTypeRegistryDefinitions<typeof mergedJobTypeRegistry>;
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

      mergedJobTypeRegistry.validateEntry("slice-a");
      mergedJobTypeRegistry.validateEntry("slice-b");
      mergedJobTypeRegistry.validateEntry("slice-c");
    });

    it("preserves type information through nested validated merges", () => {
      type TypesA = { "job-a": { entry: true; input: { a: string }; output: string } };
      type TypesB = { "job-b": { entry: true; input: { b: number }; output: number } };
      type TypesC = { "job-c": { entry: true; input: { c: boolean }; output: boolean } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);
      const c = createValidatedRegistry<TypesC>(["job-c"]);

      const ab = mergeJobTypeRegistries({ slices: [a, b] });
      const mergedJobTypeRegistry = mergeJobTypeRegistries({ slices: [ab, c] });

      type Defs = JobTypeRegistryDefinitions<typeof mergedJobTypeRegistry>;
      expectTypeOf<JobTypeProperty<Defs, "job-a", "input">>().toEqualTypeOf<{
        a: string;
      }>();
      expectTypeOf<JobTypeProperty<Defs, "job-b", "input">>().toEqualTypeOf<{
        b: number;
      }>();
      expectTypeOf<JobTypeProperty<Defs, "job-c", "input">>().toEqualTypeOf<{
        c: boolean;
      }>();

      expect(mergedJobTypeRegistry.getTypeNames()).toEqual(
        expect.arrayContaining(["job-a", "job-b", "job-c"]),
      );
      expect(mergedJobTypeRegistry.getTypeNames()).toHaveLength(3);
      mergedJobTypeRegistry.validateEntry("job-a");
      mergedJobTypeRegistry.validateEntry("job-b");
      mergedJobTypeRegistry.validateEntry("job-c");
    });

    it("detects duplicates across nested merges at compile time", () => {
      const a = defineJobTypeRegistry<{
        shared: { entry: true; input: string; output: string };
      }>();
      const b = defineJobTypeRegistry<{
        other: { entry: true; input: number; output: number };
      }>();
      const c = defineJobTypeRegistry<{
        shared: { entry: true; input: boolean; output: boolean };
      }>();

      const ab = mergeJobTypeRegistries({ slices: [a, b] });

      // @ts-expect-error — "shared" duplicated between ab and c
      mergeJobTypeRegistries({ slices: [ab, c] });
    });
  });
});
