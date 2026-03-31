import { describe, expect, it } from "vitest";

import { serializeError } from "./serialize-error.js";

describe("serializeError", () => {
  it("returns the string as-is for string errors", () => {
    expect(serializeError("something failed")).toBe("something failed");
  });

  it("returns stack trace for Error instances", () => {
    const err = new Error("boom");
    const result = serializeError(err);
    expect(result).toContain("boom");
    expect(result).toContain("serialize-error.test");
  });

  it("returns message when stack is unavailable", () => {
    const err = new Error("no stack");
    err.stack = undefined;
    expect(serializeError(err)).toBe("no stack");
  });

  it("returns 'null' for null", () => {
    expect(serializeError(null)).toBe("null");
  });

  it("returns 'undefined' for undefined", () => {
    expect(serializeError(undefined)).toBe("undefined");
  });

  it("JSON-stringifies plain objects", () => {
    const obj = { code: "ETIMEOUT", detail: "connection lost" };
    expect(serializeError(obj)).toBe(JSON.stringify(obj));
  });

  it("extracts keys from non-serializable objects", () => {
    const circular: Record<string, unknown> = { code: "ERR", msg: "fail" };
    circular.self = circular;
    expect(serializeError(circular)).toBe("{code: ERR, msg: fail, self: [object Object]}");
  });

  it("includes custom properties from Error subclasses", () => {
    class DbError extends Error {
      override name = "DbError";
      code = "PG_CONN";
      detail = "connection refused";
    }
    const err = new DbError("db failed");
    const result = serializeError(err);
    expect(result).toContain("db failed");
    expect(result).toContain("serialize-error.test");
    expect(result).toContain('"code":"PG_CONN"');
    expect(result).toContain('"detail":"connection refused"');
  });

  it("does not append properties for plain Error with no custom keys", () => {
    const err = new Error("plain");
    const result = serializeError(err);
    expect(result).not.toMatch(/\n\{/);
  });

  it("falls back to stack when Error custom properties are circular", () => {
    class BadError extends Error {
      override name = "BadError";
      ref: unknown;
    }
    const err = new BadError("circular props");
    err.ref = err;
    const result = serializeError(err);
    expect(result).toContain("circular props");
    expect(result).toContain("serialize-error.test");
    expect(result).not.toMatch(/\n\{/);
  });

  it("truncates key extraction to 5 keys", () => {
    const circular: Record<string, unknown> = {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
      f: 6,
    };
    circular.self = circular;
    expect(serializeError(circular)).toBe("{a: 1, b: 2, c: 3, d: 4, e: 5, …}");
  });

  it("truncates output exceeding 10,000 characters", () => {
    const longString = "x".repeat(20_000);
    const result = serializeError(longString);
    expect(result.length).toBeLessThan(10_100);
    expect(result).toContain("… [truncated]");
  });

  it("does not truncate output within the limit", () => {
    const shortString = "x".repeat(5_000);
    expect(serializeError(shortString)).toBe(shortString);
  });
});
