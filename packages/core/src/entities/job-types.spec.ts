import { describe, expect, it, vi } from "vitest";

import { JobTypeValidationError } from "../errors.js";
import {
  type JobTypesOptions,
  type ResolvedJobTypeValue,
  createJobTypes,
  createNoopJobTypes,
} from "./job-types.js";

const identity = async (items: readonly ResolvedJobTypeValue[]): Promise<unknown[]> =>
  items.map((i) => i.value);

describe("createJobTypes", () => {
  const createMockConfig = (overrides: Partial<JobTypesOptions> = {}): JobTypesOptions => ({
    getTypeNames: () => [],
    validateEntry: vi.fn(),
    encode: vi.fn(identity),
    decode: vi.fn(identity),
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

  describe("encode", () => {
    it("returns transformed values from adapter", async () => {
      const config = createMockConfig({
        encode: vi.fn(async (items: readonly ResolvedJobTypeValue[]) =>
          items.map((i) => ({ ...(i.value as object), transformed: true, dir: i.direction })),
        ),
      });
      const jobTypes = createJobTypes(config);

      const result = await jobTypes.encode([
        { typeName: "myJob", direction: "input", value: { value: 1 } },
        { typeName: "other", direction: "output", value: { value: 2 } },
      ]);
      expect(result).toEqual([
        { value: 1, transformed: true, dir: "input" },
        { value: 2, transformed: true, dir: "output" },
      ]);
    });

    it("supports heterogeneous batches (mixed typeName and direction)", async () => {
      const seen: { typeName: string; direction: string }[] = [];
      const config = createMockConfig({
        encode: vi.fn(async (items: readonly ResolvedJobTypeValue[]) => {
          for (const i of items) seen.push({ typeName: i.typeName, direction: i.direction });
          return items.map((i) => i.value);
        }),
      });
      const jobTypes = createJobTypes(config);

      await jobTypes.encode([
        { typeName: "a", direction: "input", value: { x: 1 } },
        { typeName: "a", direction: "output", value: { x: 2 } },
        { typeName: "b", direction: "input", value: { x: 3 } },
      ]);
      expect(seen).toEqual([
        { typeName: "a", direction: "input" },
        { typeName: "a", direction: "output" },
        { typeName: "b", direction: "input" },
      ]);
    });

    it("wraps adapter errors as invalid_input when first item is input", async () => {
      const originalError = new Error("Invalid input");
      const config = createMockConfig({
        encode: vi.fn(async () => {
          throw originalError;
        }),
      });
      const jobTypes = createJobTypes(config);

      try {
        await jobTypes.encode([{ typeName: "myJob", direction: "input", value: { bad: "input" } }]);
        throw new Error("expected throw");
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_input");
        expect(validationError.typeName).toBe("myJob");
        expect(validationError.cause).toBe(originalError);
      }
    });

    it("wraps adapter errors as invalid_output when first item is output", async () => {
      const originalError = new Error("Invalid output");
      const config = createMockConfig({
        encode: vi.fn(async () => {
          throw originalError;
        }),
      });
      const jobTypes = createJobTypes(config);

      try {
        await jobTypes.encode([{ typeName: "myJob", direction: "output", value: { ok: "yes" } }]);
        throw new Error("expected throw");
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_output");
      }
    });

    it("rejects non-JSON-serializable encoded values (Date)", async () => {
      const config = createMockConfig({
        encode: vi.fn(async () => [{ when: new Date() }]),
      });
      const jobTypes = createJobTypes(config);

      try {
        await jobTypes.encode([{ typeName: "myJob", direction: "input", value: {} }]);
        throw new Error("expected throw");
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_input");
        expect((validationError.details as { path: string }).path).toContain("when");
      }
    });
  });

  describe("decode", () => {
    it("returns transformed values from adapter", async () => {
      const config = createMockConfig({
        decode: vi.fn(async (items: readonly ResolvedJobTypeValue[]) =>
          items.map((i) => ({ ...(i.value as object), decoded: true })),
        ),
      });
      const jobTypes = createJobTypes(config);

      const result = await jobTypes.decode([
        { typeName: "myJob", direction: "input", value: { x: 1 } },
      ]);
      expect(result).toEqual([{ x: 1, decoded: true }]);
    });

    it("does not run JsonSerializable check on decoded values (runtime form may be Date)", async () => {
      const date = new Date();
      const config = createMockConfig({
        decode: vi.fn(async () => [date]),
      });
      const jobTypes = createJobTypes(config);

      const result = await jobTypes.decode([
        { typeName: "myJob", direction: "input", value: "iso" },
      ]);
      expect(result).toEqual([date]);
    });

    it("wraps adapter errors in JobTypeValidationError", async () => {
      const originalError = new Error("Corrupt persisted input");
      const config = createMockConfig({
        decode: vi.fn(async () => {
          throw originalError;
        }),
      });
      const jobTypes = createJobTypes(config);

      try {
        await jobTypes.decode([{ typeName: "myJob", direction: "input", value: "bad" }]);
        throw new Error("expected throw");
      } catch (error) {
        const validationError = error as JobTypeValidationError;
        expect(validationError.code).toBe("invalid_input");
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

  it("encode returns values unchanged for JSON-safe input", async () => {
    const jobTypes = createNoopJobTypes();
    const value = { value: 42, nested: { data: "test" } };
    const result = await jobTypes.encode([{ typeName: "anyType", direction: "input", value }]);
    expect(result).toEqual([value]);
  });

  it("decode returns values unchanged", async () => {
    const jobTypes = createNoopJobTypes();
    const value = { value: 42 };
    const result = await jobTypes.decode([{ typeName: "anyType", direction: "input", value }]);
    expect(result).toEqual([value]);
  });

  it("rejects non-JSON-serializable values on encode (Date) — protects defineJobTypes users", async () => {
    const jobTypes = createNoopJobTypes();
    try {
      await jobTypes.encode([
        { typeName: "anyType", direction: "input", value: { when: new Date() } },
      ]);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(JobTypeValidationError);
      expect((error as JobTypeValidationError).code).toBe("invalid_input");
    }
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
