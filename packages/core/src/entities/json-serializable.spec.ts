import { describe, expect, it } from "vitest";

import { isJsonSerializable } from "./json-serializable.js";

describe("isJsonSerializable", () => {
  describe("primitives", () => {
    it.each([
      ["string", "hello"],
      ["empty string", ""],
      ["zero", 0],
      ["positive int", 42],
      ["negative float", -3.14],
      ["true", true],
      ["false", false],
      ["null", null],
    ])("accepts %s", (_label, value) => {
      expect(isJsonSerializable(value)).toBe(true);
    });

    it.each([
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["undefined", undefined],
      ["bigint", 1n],
      ["symbol", Symbol("x")],
      ["function", () => 0],
    ])("rejects %s at root", (_label, value) => {
      const result = isJsonSerializable(value);
      expect(result).toEqual({ path: "(root)" });
    });
  });

  describe("plain objects", () => {
    it("accepts empty object", () => {
      expect(isJsonSerializable({})).toBe(true);
    });

    it("accepts nested plain objects", () => {
      expect(isJsonSerializable({ a: { b: { c: "deep" } } })).toBe(true);
    });

    it("accepts undefined as object property (optional fields)", () => {
      expect(isJsonSerializable({ label: undefined, name: "x" })).toBe(true);
    });

    it("accepts Object.create(null)", () => {
      const obj = Object.create(null) as Record<string, unknown>;
      obj.x = 1;
      expect(isJsonSerializable(obj)).toBe(true);
    });

    it("rejects Date", () => {
      const result = isJsonSerializable(new Date());
      expect(result).toEqual({ path: "(root)" });
    });

    it("rejects Map", () => {
      const result = isJsonSerializable(new Map());
      expect(result).toEqual({ path: "(root)" });
    });

    it("rejects Set", () => {
      const result = isJsonSerializable(new Set());
      expect(result).toEqual({ path: "(root)" });
    });

    it("rejects class instance", () => {
      class Foo {
        x = 1;
      }
      const result = isJsonSerializable(new Foo());
      expect(result).toEqual({ path: "(root)" });
    });

    it("reports nested path on failure", () => {
      const result = isJsonSerializable({ user: { dob: new Date() } });
      expect(result).toEqual({ path: "user.dob" });
    });

    it("reports nested path for invalid number", () => {
      const result = isJsonSerializable({ stats: { ratio: Number.NaN } });
      expect(result).toEqual({ path: "stats.ratio" });
    });
  });

  describe("arrays", () => {
    it("accepts empty array", () => {
      expect(isJsonSerializable([])).toBe(true);
    });

    it("accepts array of primitives", () => {
      expect(isJsonSerializable([1, "a", true, null])).toBe(true);
    });

    it("rejects array containing Date", () => {
      const result = isJsonSerializable(["a", new Date()]);
      expect(result).toEqual({ path: "[1]" });
    });

    it("rejects undefined element in array", () => {
      const result = isJsonSerializable([1, undefined, 3]);
      expect(result).toEqual({ path: "[1]" });
    });

    it("reports nested array path", () => {
      const result = isJsonSerializable({ rows: [{ col: 1 }, { col: Number.NaN }] });
      expect(result).toEqual({ path: "rows[1].col" });
    });
  });

  describe("cycles", () => {
    it("detects self-reference", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      const result = isJsonSerializable(obj);
      expect(result).toEqual({ path: "self [cycle]" });
    });

    it("detects mutual cycle", () => {
      const a: Record<string, unknown> = {};
      const b: Record<string, unknown> = { back: a };
      a.b = b;
      const result = isJsonSerializable(a);
      expect(result).toEqual({ path: "b.back [cycle]" });
    });
  });
});
