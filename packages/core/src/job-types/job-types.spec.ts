import { describe, expect, it, vi } from "vitest";

import { createJobTypes, createNoopJobTypes } from "./job-types.ts";

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
      const jobTypes = createJobTypes(
        createMockConfig({
          validateEntry: () => {
            throw originalError;
          },
        }),
      );

      expect(() => {
        jobTypes.validateEntry("myJob");
      }).toThrow(
        expect.objectContaining({
          code: "not_entry_point",
          typeName: "myJob",
          cause: originalError,
        }),
      );
    });
  });

  describe("input encoding", () => {
    it("returns the adapter's encoded value", () => {
      const config = createMockConfig({ encodeInput: vi.fn(() => ({ stored: true })) });
      const jobTypes = createJobTypes(config);

      expect(jobTypes.encodeInput("myJob", { value: 1 })).toEqual({ stored: true });
      expect(config.encodeInput).toHaveBeenCalledWith("myJob", { value: 1 });
    });

    it("wraps adapter errors as invalid_input carrying only that value", () => {
      const originalError = new Error("Invalid");
      const jobTypes = createJobTypes(
        createMockConfig({
          encodeInput: () => {
            throw originalError;
          },
        }),
      );

      expect(() => jobTypes.encodeInput("myJob", { bad: true })).toThrow(
        expect.objectContaining({
          code: "invalid_input",
          typeName: "myJob",
          details: { input: { bad: true } },
          cause: originalError,
        }),
      );
    });

    it("rejects an encoded value that is not JSON-serializable with the path to it", () => {
      const date = new Date();
      const jobTypes = createJobTypes(createMockConfig({ encodeInput: () => ({ when: date }) }));

      expect(() => jobTypes.encodeInput("myJob", {})).toThrow(
        expect.objectContaining({
          code: "invalid_input",
          message: 'Encoded input for job type "myJob" is not JSON-serializable at ["when"]',
          details: { input: { when: date }, path: ["when"] },
        }),
      );
    });

    it("reports a value nested too deeply by a shortened path, without the value", () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const jobTypes = createJobTypes(createMockConfig({ encodeInput: () => cyclic }));

      expect(() => jobTypes.encodeInput("myJob", {})).toThrow(
        expect.objectContaining({
          code: "invalid_input",
          message: 'Encoded input for job type "myJob" is nested deeper than 1000 levels',
          details: { path: Array.from({ length: 20 }, () => "self") },
        }),
      );
    });

    it("rejects a promise returned by the adapter", () => {
      const jobTypes = createJobTypes(
        createMockConfig({ encodeInput: async (_typeName, value) => value }),
      );

      expect(() => jobTypes.encodeInput("myJob", {})).toThrow(
        expect.objectContaining({
          code: "invalid_input",
          message:
            'Encoder for the input of job type "myJob" returned a promise; it must return the value',
        }),
      );
    });
  });

  describe("output encoding", () => {
    it("wraps adapter errors as invalid_output carrying only that value", () => {
      const originalError = new Error("Invalid");
      const jobTypes = createJobTypes(
        createMockConfig({
          encodeOutput: () => {
            throw originalError;
          },
        }),
      );

      expect(() => jobTypes.encodeOutput("myJob", { bad: true })).toThrow(
        expect.objectContaining({
          code: "invalid_output",
          details: { output: { bad: true } },
          cause: originalError,
        }),
      );
    });

    it("rejects an encoded value that is not JSON-serializable with the path to it", () => {
      const date = new Date();
      const jobTypes = createJobTypes(createMockConfig({ encodeOutput: () => [date] }));

      expect(() => jobTypes.encodeOutput("myJob", {})).toThrow(
        expect.objectContaining({
          code: "invalid_output",
          details: { output: [date], path: [0] },
        }),
      );
    });
  });

  describe("input decoding", () => {
    it("returns the adapter's decoded value for a known type", () => {
      const date = new Date();
      const jobTypes = createJobTypes(
        createMockConfig({ getTypeNames: () => ["myJob"], decodeInput: () => date }),
      );

      expect(jobTypes.decodeInput("myJob", "iso")).toBe(date);
    });

    it("returns the stored value of a type the registry does not know without calling the adapter", () => {
      const config = createMockConfig({ getTypeNames: () => ["myJob"] });
      const jobTypes = createJobTypes(config);

      expect(jobTypes.decodeInput("removedJob", { raw: 1 })).toEqual({ raw: 1 });
      expect(config.decodeInput).not.toHaveBeenCalled();
    });

    it("reads the known type names once, when the registry is created", () => {
      const getTypeNames = vi.fn(() => ["myJob"]);
      const jobTypes = createJobTypes(createMockConfig({ getTypeNames }));

      jobTypes.decodeInput("myJob", {});
      jobTypes.decodeInput("removedJob", {});

      expect(getTypeNames).toHaveBeenCalledTimes(1);
    });

    it("rejects a promise returned by the adapter", () => {
      const jobTypes = createJobTypes(
        createMockConfig({
          getTypeNames: () => ["myJob"],
          decodeInput: async (_typeName, value) => value,
        }),
      );

      expect(() => jobTypes.decodeInput("myJob", {})).toThrow(
        expect.objectContaining({
          code: "invalid_input",
          message:
            'Decoder for the input of job type "myJob" returned a promise; it must return the value',
        }),
      );
    });

    it("wraps adapter errors as invalid_input carrying only that value", () => {
      const originalError = new Error("Corrupt stored value");
      const jobTypes = createJobTypes(
        createMockConfig({
          getTypeNames: () => ["myJob"],
          decodeInput: () => {
            throw originalError;
          },
        }),
      );

      expect(() => jobTypes.decodeInput("myJob", "bad")).toThrow(
        expect.objectContaining({
          code: "invalid_input",
          details: { input: "bad" },
          cause: originalError,
        }),
      );
    });
  });

  describe("output decoding", () => {
    it("wraps adapter errors as invalid_output carrying only that value", () => {
      const originalError = new Error("Corrupt stored value");
      const jobTypes = createJobTypes(
        createMockConfig({
          getTypeNames: () => ["myJob"],
          decodeOutput: () => {
            throw originalError;
          },
        }),
      );

      expect(() => jobTypes.decodeOutput("myJob", "bad")).toThrow(
        expect.objectContaining({
          code: "invalid_output",
          details: { output: "bad" },
          cause: originalError,
        }),
      );
    });

    it("returns the stored value of a type the registry does not know", () => {
      const jobTypes = createJobTypes(createMockConfig({ getTypeNames: () => ["myJob"] }));

      expect(jobTypes.decodeOutput("removedJob", { raw: 1 })).toEqual({ raw: 1 });
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
      const jobTypes = createJobTypes(
        createMockConfig({
          validateContinueWith: () => {
            throw originalError;
          },
        }),
      );

      expect(() => {
        jobTypes.validateContinueWith("fromJob", { typeName: "toJob", input: {} });
      }).toThrow(
        expect.objectContaining({
          code: "invalid_continuation",
          typeName: "fromJob",
          details: { target: { typeName: "toJob", input: {} } },
          cause: originalError,
        }),
      );
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
      const jobTypes = createJobTypes(
        createMockConfig({
          validateBlockers: () => {
            throw originalError;
          },
        }),
      );
      const blockers = [{ typeName: "bad", input: {} }];

      expect(() => {
        jobTypes.validateBlockers("main", blockers);
      }).toThrow(
        expect.objectContaining({
          code: "invalid_blockers",
          typeName: "main",
          details: { blockers },
          cause: originalError,
        }),
      );
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
