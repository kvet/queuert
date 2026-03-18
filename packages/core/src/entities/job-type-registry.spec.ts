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
    getTypeNames: () => [],
    validateEntry: vi.fn(),
    parseInput: vi.fn((_, input) => input),
    parseOutput: vi.fn((_, output) => output),
    validateContinueWith: vi.fn(),
    validateBlockers: vi.fn(),
    ...overrides,
  });

  describe("getTypeNames", () => {
    it("returns type names from config", () => {
      const config = createMockConfig({ getTypeNames: () => ["job-a", "job-b"] });
      const jobTypeRegistry = createJobTypeRegistry(config);

      expect(jobTypeRegistry.getTypeNames()).toEqual(["job-a", "job-b"]);
    });

    it("delegates to config.getTypeNames", () => {
      const typeNames = ["x", "y", "z"];
      const getTypeNames = vi.fn(() => typeNames);
      const config = createMockConfig({ getTypeNames });
      const jobTypeRegistry = createJobTypeRegistry(config);

      jobTypeRegistry.getTypeNames();
      expect(getTypeNames).toHaveBeenCalled();
    });

    it("returns empty array when config provides none", () => {
      const config = createMockConfig();
      const jobTypeRegistry = createJobTypeRegistry(config);

      expect(jobTypeRegistry.getTypeNames()).toEqual([]);
    });
  });

  describe("validateEntry", () => {
    it("passes when adapter does not throw", () => {
      const config = createMockConfig();
      const jobTypeRegistry = createJobTypeRegistry(config);

      expect(() => {
        jobTypeRegistry.validateEntry("myJob");
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
      const jobTypeRegistry = createJobTypeRegistry(config);

      expect(() => {
        jobTypeRegistry.validateEntry("myJob");
      }).toThrow(JobTypeValidationError);
      try {
        jobTypeRegistry.validateEntry("myJob");
      } catch (error) {
        expect(error).toBeInstanceOf(JobTypeValidationError);
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("not_entry_point");
        expect(validationError.typeName).toBe("myJob");
        expect(validationError.cause).toBe(originalError);
      }
    });
  });

  describe("parseInput", () => {
    it("returns transformed value from adapter", () => {
      const config = createMockConfig({
        parseInput: vi.fn((_, input) => ({ ...input, transformed: true })),
      });
      const jobTypeRegistry = createJobTypeRegistry(config);

      const result = jobTypeRegistry.parseInput("myJob", { value: 1 });
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
      const jobTypeRegistry = createJobTypeRegistry(config);

      expect(() => jobTypeRegistry.parseInput("myJob", { bad: "input" })).toThrow(
        JobTypeValidationError,
      );
      try {
        jobTypeRegistry.parseInput("myJob", { bad: "input" });
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_input");
        expect(validationError.typeName).toBe("myJob");
        expect(validationError.details.input).toEqual({ bad: "input" });
        expect(validationError.cause).toBe(originalError);
      }
    });
  });

  describe("parseOutput", () => {
    it("returns transformed value from adapter", () => {
      const config = createMockConfig({
        parseOutput: vi.fn((_, output) => ({ ...output, validated: true })),
      });
      const jobTypeRegistry = createJobTypeRegistry(config);

      const result = jobTypeRegistry.parseOutput("myJob", { result: 42 });
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
      const jobTypeRegistry = createJobTypeRegistry(config);

      expect(() => jobTypeRegistry.parseOutput("myJob", { bad: "output" })).toThrow(
        JobTypeValidationError,
      );
      try {
        jobTypeRegistry.parseOutput("myJob", { bad: "output" });
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_output");
        expect(validationError.typeName).toBe("myJob");
        expect(validationError.details.output).toEqual({ bad: "output" });
        expect(validationError.cause).toBe(originalError);
      }
    });
  });

  describe("validateContinueWith", () => {
    it("passes when adapter does not throw", () => {
      const config = createMockConfig();
      const jobTypeRegistry = createJobTypeRegistry(config);
      const to = { typeName: "nextJob", input: { data: "test" } };

      expect(() => {
        jobTypeRegistry.validateContinueWith("fromJob", to);
      }).not.toThrow();
      expect(config.validateContinueWith).toHaveBeenCalledWith("fromJob", to);
    });

    it("receives { typeName, input } for nominal validation", () => {
      const validateContinueWith = vi.fn();
      const config = createMockConfig({ validateContinueWith });
      const jobTypeRegistry = createJobTypeRegistry(config);

      jobTypeRegistry.validateContinueWith("step1", { typeName: "step2", input: { id: 123 } });

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
      const jobTypeRegistry = createJobTypeRegistry(config);

      // Valid structural match
      expect(() => {
        jobTypeRegistry.validateContinueWith("router", {
          typeName: "handler",
          input: { payload: { data: "test" } },
        });
      }).not.toThrow();

      // Invalid structural match - wraps error
      expect(() => {
        jobTypeRegistry.validateContinueWith("router", {
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
      const jobTypeRegistry = createJobTypeRegistry(config);

      expect(() => {
        jobTypeRegistry.validateContinueWith("fromJob", { typeName: "toJob", input: {} });
      }).toThrow(JobTypeValidationError);
      try {
        jobTypeRegistry.validateContinueWith("fromJob", { typeName: "toJob", input: {} });
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_continuation");
        expect(validationError.typeName).toBe("fromJob");
        expect(validationError.message).toContain("fromJob");
        expect(validationError.message).toContain("toJob");
        expect(validationError.details.target).toEqual({ typeName: "toJob", input: {} });
        expect(validationError.cause).toBe(originalError);
      }
    });
  });

  describe("validateBlockers", () => {
    it("passes when adapter does not throw", () => {
      const config = createMockConfig();
      const jobTypeRegistry = createJobTypeRegistry(config);
      const blockers = [
        { typeName: "auth", input: { token: "abc" } },
        { typeName: "config", input: { key: "setting" } },
      ];

      expect(() => {
        jobTypeRegistry.validateBlockers("main", blockers);
      }).not.toThrow();
      expect(config.validateBlockers).toHaveBeenCalledWith("main", blockers);
    });

    it("receives array of { typeName, input } for nominal validation", () => {
      const validateBlockers = vi.fn();
      const config = createMockConfig({ validateBlockers });
      const jobTypeRegistry = createJobTypeRegistry(config);

      const blockers = [{ typeName: "auth", input: { userId: "123" } }];
      jobTypeRegistry.validateBlockers("main", blockers);

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
      const jobTypeRegistry = createJobTypeRegistry(config);

      // Valid structural match
      expect(() => {
        jobTypeRegistry.validateBlockers("main", [
          { typeName: "auth", input: { token: "abc" } },
          { typeName: "authAlt", input: { token: "xyz" } },
        ]);
      }).not.toThrow();

      // Invalid structural match - wraps error
      expect(() => {
        jobTypeRegistry.validateBlockers("main", [{ typeName: "auth", input: { noToken: true } }]);
      }).toThrow(JobTypeValidationError);
    });

    it("wraps adapter errors in JobTypeValidationError", () => {
      const originalError = new Error("Invalid blockers");
      const config = createMockConfig({
        validateBlockers: vi.fn(() => {
          throw originalError;
        }),
      });
      const jobTypeRegistry = createJobTypeRegistry(config);

      const blockers = [{ typeName: "bad", input: {} }];
      expect(() => {
        jobTypeRegistry.validateBlockers("main", blockers);
      }).toThrow(JobTypeValidationError);
      try {
        jobTypeRegistry.validateBlockers("main", blockers);
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_blockers");
        expect(validationError.typeName).toBe("main");
        expect(validationError.details.blockers).toEqual(blockers);
        expect(validationError.cause).toBe(originalError);
      }
    });
  });
});

describe("createNoopJobTypeRegistry", () => {
  it("getTypeNames returns empty array", () => {
    const jobTypeRegistry = createNoopJobTypeRegistry();
    expect(jobTypeRegistry.getTypeNames()).toEqual([]);
  });

  it("validateEntry does nothing", () => {
    const jobTypeRegistry = createNoopJobTypeRegistry();
    expect(() => {
      jobTypeRegistry.validateEntry("anyType");
    }).not.toThrow();
  });

  it("parseInput returns input unchanged", () => {
    const jobTypeRegistry = createNoopJobTypeRegistry();
    const input = { value: 42, nested: { data: "test" } };
    expect(jobTypeRegistry.parseInput("anyType", input)).toBe(input);
  });

  it("parseOutput returns output unchanged", () => {
    const jobTypeRegistry = createNoopJobTypeRegistry();
    const output = { result: "success", count: 10 };
    expect(jobTypeRegistry.parseOutput("anyType", output)).toBe(output);
  });

  it("validateContinueWith does nothing", () => {
    const jobTypeRegistry = createNoopJobTypeRegistry();
    expect(() => {
      jobTypeRegistry.validateContinueWith("from", { typeName: "to", input: { any: "value" } });
    }).not.toThrow();
  });

  it("validateBlockers does nothing", () => {
    const jobTypeRegistry = createNoopJobTypeRegistry();
    expect(() => {
      jobTypeRegistry.validateBlockers("main", [
        { typeName: "a", input: {} },
        { typeName: "b", input: { data: 123 } },
      ]);
    }).not.toThrow();
  });
});
