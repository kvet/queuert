import { describe, expect, it, vi } from "vitest";
import { DuplicateJobTypeError, JobTypeValidationError } from "../errors.js";
import {
  type JobTypeRegistryConfig,
  type JobTypeRegistryDefinitions,
  createJobTypeRegistry,
} from "./job-type-registry.js";
import { mergeJobTypeRegistries } from "./merge-job-type-registries.js";
import { defineJobTypes } from "./job-type.js";

const createValidatedRegistry = <T>(typeNames: string[]) => {
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
      const a = defineJobTypes<{
        "job-a": { entry: true; input: { id: string }; output: string };
      }>();
      const b = defineJobTypes<{
        "job-b": { entry: true; input: { count: number }; output: number };
      }>();

      const merged = mergeJobTypeRegistries(a, b);

      merged.validateEntry("job-a");
      merged.validateEntry("job-b");
      expect(merged.parseInput("job-a", { id: "test" })).toEqual({ id: "test" });
      expect(merged.parseInput("job-b", { count: 42 })).toEqual({ count: 42 });
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

      const merged = mergeJobTypeRegistries(a, b, c);

      merged.validateEntry("job-a");
      merged.validateEntry("job-b");
      merged.validateEntry("job-c");
    });

    it("returns passthrough behavior", () => {
      const a = defineJobTypes<{
        "job-a": { entry: true; input: { id: string }; output: string };
      }>();
      const b = defineJobTypes<{
        "job-b": { entry: true; input: { count: number }; output: number };
      }>();

      const merged = mergeJobTypeRegistries(a, b);
      const input = { id: "test" };

      expect(merged.parseInput("job-a", input)).toBe(input);
      expect(merged.parseOutput("job-a", "result")).toBe("result");
      expect(() => {
        merged.validateContinueWith("job-a", { typeName: "job-b", input: {} });
      }).not.toThrow();
      expect(() => {
        merged.validateBlockers("job-a", [{ typeName: "job-b", input: {} }]);
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
      mergeJobTypeRegistries(a, b);
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
      mergeJobTypeRegistries(a, b, c);
    });

    it("preserves phantom type information", () => {
      const a = defineJobTypes<{
        "create-order": { entry: true; input: { userId: string }; output: { orderId: string } };
      }>();
      const b = defineJobTypes<{
        "send-email": { entry: true; input: { to: string }; output: { sent: boolean } };
      }>();

      const merged = mergeJobTypeRegistries(a, b);

      type MergedDefs = JobTypeRegistryDefinitions<typeof merged>;
      type _AssertOrder = MergedDefs["create-order"]["input"] extends { userId: string }
        ? true
        : never;
      type _AssertEmail = MergedDefs["send-email"]["input"] extends { to: string } ? true : never;

      const _check: [_AssertOrder, _AssertEmail] = [true, true];
      void _check;
    });
  });

  describe("validated registries", () => {
    it("delegates to the correct source registry", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const merged = mergeJobTypeRegistries(a, b);

      merged.validateEntry("job-a");
      merged.validateEntry("job-b");
      expect(merged.parseInput("job-a", "hello")).toBe("hello");
      expect(merged.parseInput("job-b", 42)).toBe(42);
    });

    it("delegates parseOutput to the correct source registry", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const merged = mergeJobTypeRegistries(a, b);

      expect(merged.parseOutput("job-a", "result")).toBe("result");
      expect(merged.parseOutput("job-b", 99)).toBe(99);
    });

    it("returns type names from all validated registries", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const merged = mergeJobTypeRegistries(a, b);

      expect(merged.getTypeNames()).toEqual(expect.arrayContaining(["job-a", "job-b"]));
      expect(merged.getTypeNames()).toHaveLength(2);
    });

    it("throws for unknown type when all registries are validated", () => {
      type TypesA = { "job-a": { entry: true; input: string; output: string } };
      type TypesB = { "job-b": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["job-a"]);
      const b = createValidatedRegistry<TypesB>(["job-b"]);

      const merged = mergeJobTypeRegistries(a, b);

      expect(() => {
        merged.validateEntry("job-unknown");
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

      const merged = mergeJobTypeRegistries(a, b);
      const target = { typeName: "job-b", input: 42 };

      merged.validateContinueWith("job-a", target);
      expect(configA.validateContinueWith).toHaveBeenCalledWith("job-a", target);

      merged.validateBlockers("job-a", [target]);
      expect(configA.validateBlockers).toHaveBeenCalledWith("job-a", [target]);
    });

    it("throws DuplicateJobTypeError for overlapping type names at runtime", () => {
      type TypesA = { "shared-job": { entry: true; input: string; output: string } };
      type TypesB = { "shared-job": { entry: true; input: number; output: number } };

      const a = createValidatedRegistry<TypesA>(["shared-job"]);
      const b = createValidatedRegistry<TypesB>(["shared-job"]);

      expect(() => {
        // @ts-expect-error — also detected at compile time
        mergeJobTypeRegistries(a, b);
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
        mergeJobTypeRegistries(a, b);
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
        mergeJobTypeRegistries(a, b, c);
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

      const merged = mergeJobTypeRegistries(a, b);

      expect(() => {
        merged.parseInput("job-a", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("mixed noop + validated registries", () => {
    it("validates types from validated registry, passes through noop types", () => {
      const noop = defineJobTypes<{
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

      const merged = mergeJobTypeRegistries(noop, validated);

      merged.validateEntry("validated-job");
      expect(validateEntryCalled).toBe(true);

      merged.validateEntry("noop-job");
      expect(merged.parseInput("noop-job", { id: "test" })).toEqual({ id: "test" });
    });

    it("returns only validated registry type names from getTypeNames", () => {
      const noop = defineJobTypes<{
        "noop-job": { entry: true; input: string; output: string };
      }>();
      const validated = createValidatedRegistry<{
        "validated-job": { entry: true; input: number; output: number };
      }>(["validated-job"]);

      const merged = mergeJobTypeRegistries(noop, validated);

      expect(merged.getTypeNames()).toEqual(["validated-job"]);
    });

    it("passes through parseInput for noop types in mixed mode", () => {
      const noop = defineJobTypes<{
        "noop-job": { entry: true; input: { id: string }; output: string };
      }>();
      const validated = createValidatedRegistry<{
        "validated-job": { entry: true; input: number; output: number };
      }>(["validated-job"]);

      const merged = mergeJobTypeRegistries(noop, validated);
      const input = { id: "test" };

      expect(merged.parseInput("noop-job", input)).toBe(input);
      expect(merged.parseInput("validated-job", 42)).toBe(42);
    });
  });
});
