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
    ])("rejects %s", (_label, value) => {
      const result = isJsonSerializable(value);
      expect(result).toBe(false);
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
      expect(result).toBe(false);
    });

    it("rejects Map", () => {
      const result = isJsonSerializable(new Map());
      expect(result).toBe(false);
    });

    it("rejects Set", () => {
      const result = isJsonSerializable(new Set());
      expect(result).toBe(false);
    });

    it("rejects class instance", () => {
      class Foo {
        x = 1;
      }
      const result = isJsonSerializable(new Foo());
      expect(result).toBe(false);
    });

    it("rejects a nested Date", () => {
      const result = isJsonSerializable({ user: { dob: new Date() } });
      expect(result).toBe(false);
    });

    it("rejects a nested invalid number", () => {
      const result = isJsonSerializable({ stats: { ratio: Number.NaN } });
      expect(result).toBe(false);
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
      expect(result).toBe(false);
    });

    it("rejects undefined element in array", () => {
      const result = isJsonSerializable([1, undefined, 3]);
      expect(result).toBe(false);
    });

    it("rejects an invalid number inside an array of objects", () => {
      const result = isJsonSerializable({ rows: [{ col: 1 }, { col: Number.NaN }] });
      expect(result).toBe(false);
    });
  });

  describe("cycles", () => {
    it("detects self-reference", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      const result = isJsonSerializable(obj);
      expect(result).toBe(false);
    });

    it("detects mutual cycle", () => {
      const a: Record<string, unknown> = {};
      const b: Record<string, unknown> = { back: a };
      a.b = b;
      const result = isJsonSerializable(a);
      expect(result).toBe(false);
    });

    it("accepts an object referenced more than once without a cycle", () => {
      const address = { city: "Lisbon" };
      expect(isJsonSerializable({ billing: address, shipping: address })).toBe(true);
      expect(isJsonSerializable([address, address])).toBe(true);
    });
  });

  describe("depth", () => {
    const nest = (levels: number): unknown => {
      let value: unknown = "leaf";
      for (let i = 0; i < levels; i++) value = { child: value };
      return value;
    };

    it("accepts values nested 1000 levels deep", () => {
      expect(isJsonSerializable(nest(1000))).toBe(true);
    });

    it("rejects values nested deeper than 1000 levels", () => {
      expect(isJsonSerializable(nest(1001))).toBe(false);
    });
  });
});
