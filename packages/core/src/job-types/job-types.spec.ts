import { describe, expect, it, vi } from "vitest";

import { JobTypeValidationError } from "../errors.js";
import { createJobTypes, createNoopJobTypes } from "./job-types.js";

const identity = (_typeName: string, value: unknown): unknown => value;

describe("createJobTypes", () => {
  const createMockConfig = (
    overrides: Partial<Parameters<typeof createJobTypes>[0]> = {},
  ): Parameters<typeof createJobTypes>[0] => ({
    getTypeNames: () => [],
    validateEntry: vi.fn(),
    encodeInput: vi.fn(identity),
    decodeInput: vi.fn(identity),
    encodeOutput: vi.fn(identity),
    decodeOutput: vi.fn(identity),
    validateContinueWith: vi.fn(),
    validateBlockers: vi.fn(),
    ...overrides,
  });

  describe("getTypeNames", () => {
    it("returns type names from config", () => {
      const config = createMockConfig({ getTypeNames: () => ["job-a", "job-b"] });
      const jobTypes = createJobTypes(config);

      expect(jobTypes.getTypeNames()).toEqual(["job-a", "job-b"]);
    });

    it("returns empty array when config provides none", () => {
      const config = createMockConfig();
      const jobTypes = createJobTypes(config);

      expect(jobTypes.getTypeNames()).toEqual([]);
    });
  });

  describe("validateEntry", () => {
    it("passes when adapter does not throw", () => {
      const config = createMockConfig();
      const jobTypes = createJobTypes(config);

      expect(() => {
        jobTypes.validateEntry("myJob");
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
      const jobTypes = createJobTypes(config);

      expect(() => {
        jobTypes.validateEntry("myJob");
      }).toThrow(JobTypeValidationError);
      try {
        jobTypes.validateEntry("myJob");
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("not_entry_point");
        expect(validationError.typeName).toBe("myJob");
        expect(validationError.cause).toBe(originalError);
      }
    });
  });

  describe.each([
    ["input", "encodeInput", "invalid_input"],
    ["output", "encodeOutput", "invalid_output"],
  ] as const)("%s encoding", (field, method, code) => {
    it("returns the adapter's encoded value", () => {
      const config = createMockConfig({ [method]: vi.fn(() => ({ stored: true })) });
      const jobTypes = createJobTypes(config);

      expect(jobTypes[method]("myJob", { value: 1 })).toEqual({ stored: true });
      expect(config[method]).toHaveBeenCalledWith("myJob", { value: 1 });
    });

    it(`wraps adapter errors as ${code} carrying only that value`, () => {
      const originalError = new Error("Invalid");
      const config = createMockConfig({
        [method]: vi.fn(() => {
          throw originalError;
        }),
      });
      const jobTypes = createJobTypes(config);

      try {
        jobTypes[method]("myJob", { bad: true });
        throw new Error("expected throw");
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError).toBeInstanceOf(JobTypeValidationError);
        expect(validationError.code).toBe(code);
        expect(validationError.typeName).toBe("myJob");
        expect(validationError.details).toEqual({ [field]: { bad: true } });
        expect(validationError.cause).toBe(originalError);
      }
    });

    it("rejects an encoded value that is not JSON-serializable", () => {
      const config = createMockConfig({ [method]: vi.fn(() => ({ when: new Date() })) });
      const jobTypes = createJobTypes(config);

      try {
        jobTypes[method]("myJob", {});
        throw new Error("expected throw");
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe(code);
        expect(validationError.message).toMatch(/not JSON-serializable/);
      }
    });

    it("rejects a promise returned by the adapter", () => {
      const config = createMockConfig({
        [method]: vi.fn(async (_typeName: string, value: unknown) => value),
      });
      const jobTypes = createJobTypes(config);

      expect(() => jobTypes[method]("myJob", {})).toThrow(JobTypeValidationError);
    });
  });

  describe.each([
    ["input", "decodeInput", "invalid_input"],
    ["output", "decodeOutput", "invalid_output"],
  ] as const)("%s decoding", (field, method, code) => {
    it("returns the adapter's decoded value for a known type", () => {
      const date = new Date();
      const config = createMockConfig({
        getTypeNames: () => ["myJob"],
        [method]: vi.fn(() => date),
      });
      const jobTypes = createJobTypes(config);

      expect(jobTypes[method]("myJob", "iso")).toBe(date);
    });

    it("returns the stored value of a type the registry does not know without calling the adapter", () => {
      const config = createMockConfig({ getTypeNames: () => ["myJob"] });
      const jobTypes = createJobTypes(config);

      expect(jobTypes[method]("removedJob", { raw: 1 })).toEqual({ raw: 1 });
      expect(config[method]).not.toHaveBeenCalled();
    });

    it("rejects a promise returned by the adapter", () => {
      const config = createMockConfig({
        getTypeNames: () => ["myJob"],
        [method]: vi.fn(async (_typeName: string, value: unknown) => value),
      });
      const jobTypes = createJobTypes(config);

      expect(() => jobTypes[method]("myJob", {})).toThrow(JobTypeValidationError);
    });

    it(`wraps adapter errors as ${code} carrying only that value`, () => {
      const originalError = new Error("Corrupt stored value");
      const config = createMockConfig({
        getTypeNames: () => ["myJob"],
        [method]: vi.fn(() => {
          throw originalError;
        }),
      });
      const jobTypes = createJobTypes(config);

      try {
        jobTypes[method]("myJob", "bad");
        throw new Error("expected throw");
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe(code);
        expect(validationError.details).toEqual({ [field]: "bad" });
        expect(validationError.cause).toBe(originalError);
      }
    });
  });

  describe("validateContinueWith", () => {
    it("passes when adapter does not throw", () => {
      const config = createMockConfig();
      const jobTypes = createJobTypes(config);
      const to = { typeName: "nextJob", input: { data: "test" } };

      expect(() => {
        jobTypes.validateContinueWith("fromJob", to);
      }).not.toThrow();
      expect(config.validateContinueWith).toHaveBeenCalledWith("fromJob", to);
    });

    it("wraps adapter errors in JobTypeValidationError", () => {
      const originalError = new Error("Invalid continuation");
      const config = createMockConfig({
        validateContinueWith: vi.fn(() => {
          throw originalError;
        }),
      });
      const jobTypes = createJobTypes(config);

      expect(() => {
        jobTypes.validateContinueWith("fromJob", { typeName: "toJob", input: {} });
      }).toThrow(JobTypeValidationError);
      try {
        jobTypes.validateContinueWith("fromJob", { typeName: "toJob", input: {} });
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_continuation");
        expect(validationError.typeName).toBe("fromJob");
        expect(validationError.details.target).toEqual({ typeName: "toJob", input: {} });
        expect(validationError.cause).toBe(originalError);
      }
    });
  });

  describe("validateBlockers", () => {
    it("passes when adapter does not throw", () => {
      const config = createMockConfig();
      const jobTypes = createJobTypes(config);
      const blockers = [
        { typeName: "auth", input: { token: "abc" } },
        { typeName: "config", input: { key: "setting" } },
      ];

      expect(() => {
        jobTypes.validateBlockers("main", blockers);
      }).not.toThrow();
      expect(config.validateBlockers).toHaveBeenCalledWith("main", blockers);
    });

    it("wraps adapter errors in JobTypeValidationError", () => {
      const originalError = new Error("Invalid blockers");
      const config = createMockConfig({
        validateBlockers: vi.fn(() => {
          throw originalError;
        }),
      });
      const jobTypes = createJobTypes(config);

      const blockers = [{ typeName: "bad", input: {} }];
      expect(() => {
        jobTypes.validateBlockers("main", blockers);
      }).toThrow(JobTypeValidationError);
      try {
        jobTypes.validateBlockers("main", blockers);
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

describe("createNoopJobTypes", () => {
  it("getTypeNames returns empty array", () => {
    const jobTypes = createNoopJobTypes();
    expect(jobTypes.getTypeNames()).toEqual([]);
  });

  it("validateEntry does nothing", () => {
    const jobTypes = createNoopJobTypes();
    expect(() => {
      jobTypes.validateEntry("anyType");
    }).not.toThrow();
  });

  it("encodes and decodes inputs and outputs unchanged without runtime checks", () => {
    const jobTypes = createNoopJobTypes();
    const value = { when: new Date() };
    expect(jobTypes.encodeInput("anyType", value)).toBe(value);
    expect(jobTypes.decodeInput("anyType", value)).toBe(value);
    expect(jobTypes.encodeOutput("anyType", value)).toBe(value);
    expect(jobTypes.decodeOutput("anyType", value)).toBe(value);
  });

  it("validateContinueWith does nothing", () => {
    const jobTypes = createNoopJobTypes();
    expect(() => {
      jobTypes.validateContinueWith("from", { typeName: "to", input: { any: "value" } });
    }).not.toThrow();
  });

  it("validateBlockers does nothing", () => {
    const jobTypes = createNoopJobTypes();
    expect(() => {
      jobTypes.validateBlockers("main", [
        { typeName: "a", input: {} },
        { typeName: "b", input: { data: 123 } },
      ]);
    }).not.toThrow();
  });
});
