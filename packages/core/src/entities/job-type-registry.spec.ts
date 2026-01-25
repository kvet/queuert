import { describe, expect, it, vi } from "vitest";
import { JobTypeValidationError } from "../errors.js";
import {
  type JobTypeRegistryConfig,
  createJobTypeRegistry,
  createNoopJobTypeRegistry,
} from "./job-type-registry.js";

describe("createJobTypeRegistry", () => {
  const createMockConfig = (
    overrides: Partial<JobTypeRegistryConfig> = {},
  ): JobTypeRegistryConfig => ({
    validateEntry: vi.fn(),
    parseInput: vi.fn((_, input) => input),
    parseOutput: vi.fn((_, output) => output),
    validateContinueWith: vi.fn(),
    validateBlockers: vi.fn(),
    ...overrides,
  });

  describe("validateEntry", () => {
    it("passes when adapter does not throw", () => {
      const config = createMockConfig();
      const registry = createJobTypeRegistry(config);

      expect(() => {
        registry.validateEntry("myJob");
      }).not.toThrow();
      expect(config.validateEntry).toHaveBeenCalledWith("myJob");
    });

    it("wraps adapter errors in JobTypeValidationError", () => {
      const originalError = new Error("Not an entry point");
      const config = createMockConfig({
        validateEntry: vi.fn(() => {
          throw originalError;
        }),
      });
      const registry = createJobTypeRegistry(config);

      expect(() => {
        registry.validateEntry("myJob");
      }).toThrow(JobTypeValidationError);
      try {
        registry.validateEntry("myJob");
      } catch (error) {
        expect(error).toBeInstanceOf(JobTypeValidationError);
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("not_entry_point");
        expect(validationError.typeName).toBe("myJob");
        expect(validationError.details.cause).toBe(originalError);
      }
    });
  });

  describe("parseInput", () => {
    it("returns transformed value from adapter", () => {
      const config = createMockConfig({
        parseInput: vi.fn((_, input) => ({ ...input, transformed: true })),
      });
      const registry = createJobTypeRegistry(config);

      const result = registry.parseInput("myJob", { value: 1 });
      expect(result).toEqual({ value: 1, transformed: true });
      expect(config.parseInput).toHaveBeenCalledWith("myJob", { value: 1 });
    });

    it("wraps adapter errors in JobTypeValidationError", () => {
      const originalError = new Error("Invalid input");
      const config = createMockConfig({
        parseInput: vi.fn(() => {
          throw originalError;
        }),
      });
      const registry = createJobTypeRegistry(config);

      expect(() => registry.parseInput("myJob", { bad: "input" })).toThrow(JobTypeValidationError);
      try {
        registry.parseInput("myJob", { bad: "input" });
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_input");
        expect(validationError.typeName).toBe("myJob");
        expect(validationError.details.input).toEqual({ bad: "input" });
        expect(validationError.details.cause).toBe(originalError);
      }
    });
  });

  describe("parseOutput", () => {
    it("returns transformed value from adapter", () => {
      const config = createMockConfig({
        parseOutput: vi.fn((_, output) => ({ ...output, validated: true })),
      });
      const registry = createJobTypeRegistry(config);

      const result = registry.parseOutput("myJob", { result: 42 });
      expect(result).toEqual({ result: 42, validated: true });
      expect(config.parseOutput).toHaveBeenCalledWith("myJob", { result: 42 });
    });

    it("wraps adapter errors in JobTypeValidationError", () => {
      const originalError = new Error("Invalid output");
      const config = createMockConfig({
        parseOutput: vi.fn(() => {
          throw originalError;
        }),
      });
      const registry = createJobTypeRegistry(config);

      expect(() => registry.parseOutput("myJob", { bad: "output" })).toThrow(
        JobTypeValidationError,
      );
      try {
        registry.parseOutput("myJob", { bad: "output" });
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_output");
        expect(validationError.typeName).toBe("myJob");
        expect(validationError.details.output).toEqual({ bad: "output" });
        expect(validationError.details.cause).toBe(originalError);
      }
    });
  });

  describe("validateContinueWith", () => {
    it("passes when adapter does not throw", () => {
      const config = createMockConfig();
      const registry = createJobTypeRegistry(config);
      const to = { typeName: "nextJob", input: { data: "test" } };

      expect(() => {
        registry.validateContinueWith("fromJob", to);
      }).not.toThrow();
      expect(config.validateContinueWith).toHaveBeenCalledWith("fromJob", to);
    });

    it("receives { typeName, input } for nominal validation", () => {
      const validateContinueWith = vi.fn();
      const config = createMockConfig({ validateContinueWith });
      const registry = createJobTypeRegistry(config);

      registry.validateContinueWith("step1", { typeName: "step2", input: { id: 123 } });

      expect(validateContinueWith).toHaveBeenCalledWith("step1", {
        typeName: "step2",
        input: { id: 123 },
      });
    });

    it("receives { typeName, input } for structural validation", () => {
      // Adapter can use input to validate structurally (e.g., check input shape matches target)
      const validateContinueWith = vi.fn((fromTypeName, to) => {
        // Structural validation: check input has required fields
        if (to.input && typeof to.input === "object" && !("payload" in to.input)) {
          throw new Error("Missing payload field for structural match");
        }
      });
      const config = createMockConfig({ validateContinueWith });
      const registry = createJobTypeRegistry(config);

      // Valid structural match
      expect(() => {
        registry.validateContinueWith("router", {
          typeName: "handler",
          input: { payload: { data: "test" } },
        });
      }).not.toThrow();

      // Invalid structural match - wraps error
      expect(() => {
        registry.validateContinueWith("router", {
          typeName: "handler",
          input: { wrongField: true },
        });
      }).toThrow(JobTypeValidationError);
    });

    it("wraps adapter errors in JobTypeValidationError", () => {
      const originalError = new Error("Invalid continuation");
      const config = createMockConfig({
        validateContinueWith: vi.fn(() => {
          throw originalError;
        }),
      });
      const registry = createJobTypeRegistry(config);

      expect(() => {
        registry.validateContinueWith("fromJob", { typeName: "toJob", input: {} });
      }).toThrow(JobTypeValidationError);
      try {
        registry.validateContinueWith("fromJob", { typeName: "toJob", input: {} });
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_continuation");
        expect(validationError.typeName).toBe("fromJob");
        expect(validationError.message).toContain("fromJob");
        expect(validationError.message).toContain("toJob");
        expect(validationError.details.target).toEqual({ typeName: "toJob", input: {} });
        expect(validationError.details.cause).toBe(originalError);
      }
    });
  });

  describe("validateBlockers", () => {
    it("passes when adapter does not throw", () => {
      const config = createMockConfig();
      const registry = createJobTypeRegistry(config);
      const blockers = [
        { typeName: "auth", input: { token: "abc" } },
        { typeName: "config", input: { key: "setting" } },
      ];

      expect(() => {
        registry.validateBlockers("main", blockers);
      }).not.toThrow();
      expect(config.validateBlockers).toHaveBeenCalledWith("main", blockers);
    });

    it("receives array of { typeName, input } for nominal validation", () => {
      const validateBlockers = vi.fn();
      const config = createMockConfig({ validateBlockers });
      const registry = createJobTypeRegistry(config);

      const blockers = [{ typeName: "auth", input: { userId: "123" } }];
      registry.validateBlockers("main", blockers);

      expect(validateBlockers).toHaveBeenCalledWith("main", blockers);
    });

    it("receives array of { typeName, input } for structural validation", () => {
      // Adapter can validate blockers by input shape (structural references)
      const validateBlockers = vi.fn((typeName, blockers) => {
        for (const blocker of blockers) {
          // Structural validation: check each blocker has required input fields
          if (blocker.input && typeof blocker.input === "object" && !("token" in blocker.input)) {
            throw new Error(`Blocker ${blocker.typeName} missing token field`);
          }
        }
      });
      const config = createMockConfig({ validateBlockers });
      const registry = createJobTypeRegistry(config);

      // Valid structural match
      expect(() => {
        registry.validateBlockers("main", [
          { typeName: "auth", input: { token: "abc" } },
          { typeName: "authAlt", input: { token: "xyz" } },
        ]);
      }).not.toThrow();

      // Invalid structural match - wraps error
      expect(() => {
        registry.validateBlockers("main", [{ typeName: "auth", input: { noToken: true } }]);
      }).toThrow(JobTypeValidationError);
    });

    it("wraps adapter errors in JobTypeValidationError", () => {
      const originalError = new Error("Invalid blockers");
      const config = createMockConfig({
        validateBlockers: vi.fn(() => {
          throw originalError;
        }),
      });
      const registry = createJobTypeRegistry(config);

      const blockers = [{ typeName: "bad", input: {} }];
      expect(() => {
        registry.validateBlockers("main", blockers);
      }).toThrow(JobTypeValidationError);
      try {
        registry.validateBlockers("main", blockers);
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_blockers");
        expect(validationError.typeName).toBe("main");
        expect(validationError.details.blockers).toEqual(blockers);
        expect(validationError.details.cause).toBe(originalError);
      }
    });
  });
});

describe("createNoopJobTypeRegistry", () => {
  it("validateEntry does nothing", () => {
    const registry = createNoopJobTypeRegistry();
    expect(() => {
      registry.validateEntry("anyType");
    }).not.toThrow();
  });

  it("parseInput returns input unchanged", () => {
    const registry = createNoopJobTypeRegistry();
    const input = { value: 42, nested: { data: "test" } };
    expect(registry.parseInput("anyType", input)).toBe(input);
  });

  it("parseOutput returns output unchanged", () => {
    const registry = createNoopJobTypeRegistry();
    const output = { result: "success", count: 10 };
    expect(registry.parseOutput("anyType", output)).toBe(output);
  });

  it("validateContinueWith does nothing", () => {
    const registry = createNoopJobTypeRegistry();
    expect(() => {
      registry.validateContinueWith("from", { typeName: "to", input: { any: "value" } });
    }).not.toThrow();
  });

  it("validateBlockers does nothing", () => {
    const registry = createNoopJobTypeRegistry();
    expect(() => {
      registry.validateBlockers("main", [
        { typeName: "a", input: {} },
        { typeName: "b", input: { data: 123 } },
      ]);
    }).not.toThrow();
  });
});
