import { describe, expect, it } from "vitest";

import { findNonJsonPath, isJsonSerializable } from "./json-serializable.ts";

describe("isJsonSerializable", () => {
  describe("primitives", () => {
    it("accepts strings, finite numbers, booleans and null", () => {
      expect(isJsonSerializable("hello")).toBe(true);
      expect(isJsonSerializable("")).toBe(true);
      expect(isJsonSerializable(0)).toBe(true);
      expect(isJsonSerializable(-3.14)).toBe(true);
      expect(isJsonSerializable(true)).toBe(true);
      expect(isJsonSerializable(false)).toBe(true);
      expect(isJsonSerializable(null)).toBe(true);
    });

    it("rejects non-finite numbers", () => {
      expect(isJsonSerializable(Number.NaN)).toBe(false);
      expect(isJsonSerializable(Number.POSITIVE_INFINITY)).toBe(false);
      expect(isJsonSerializable(Number.NEGATIVE_INFINITY)).toBe(false);
    });

    it("rejects undefined, bigint, symbols and functions", () => {
      expect(isJsonSerializable(undefined)).toBe(false);
      expect(isJsonSerializable(1n)).toBe(false);
      expect(isJsonSerializable(Symbol("x"))).toBe(false);
      expect(isJsonSerializable(() => 0)).toBe(false);
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
      expect(isJsonSerializable(new Date())).toBe(false);
    });

    it("rejects Map", () => {
      expect(isJsonSerializable(new Map())).toBe(false);
    });

    it("rejects Set", () => {
      expect(isJsonSerializable(new Set())).toBe(false);
    });

    it("rejects class instance", () => {
      class Foo {
        x = 1;
      }
      expect(isJsonSerializable(new Foo())).toBe(false);
    });

    it("rejects a nested Date", () => {
      expect(isJsonSerializable({ user: { dob: new Date() } })).toBe(false);
    });

    it("rejects a nested invalid number", () => {
      expect(isJsonSerializable({ stats: { ratio: Number.NaN } })).toBe(false);
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
      expect(isJsonSerializable(["a", new Date()])).toBe(false);
    });

    it("rejects undefined element in array", () => {
      expect(isJsonSerializable([1, undefined, 3])).toBe(false);
    });

    it("rejects an invalid number inside an array of objects", () => {
      expect(isJsonSerializable({ rows: [{ col: 1 }, { col: Number.NaN }] })).toBe(false);
    });
  });

  describe("cycles", () => {
    it("detects self-reference", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      expect(isJsonSerializable(obj)).toBe(false);
    });

    it("detects mutual cycle", () => {
      const a: Record<string, unknown> = {};
      const b: Record<string, unknown> = { back: a };
      a.b = b;
      expect(isJsonSerializable(a)).toBe(false);
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

describe("findNonJsonPath", () => {
  it("returns undefined for a JSON value", () => {
    expect(findNonJsonPath({ a: [1, { b: "x" }], c: undefined })).toBeUndefined();
  });

  it("returns an empty path when the value itself is not JSON", () => {
    expect(findNonJsonPath(new Date())).toEqual([]);
  });

  it("returns the keys and indexes leading to the first offending value", () => {
    expect(findNonJsonPath({ order: { items: [{ sku: "a" }, { at: new Date() }] } })).toEqual([
      "order",
      "items",
      1,
      "at",
    ]);
  });

  it("stops the path at the depth limit for a cycle", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(findNonJsonPath(obj)).toEqual(Array.from({ length: 1000 }, () => "self"));
  });
});
