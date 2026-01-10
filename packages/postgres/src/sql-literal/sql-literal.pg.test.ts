import { describe, expect, test } from "vitest";
import { pgLiteral } from "./sql-literal.pg.js";

describe("pgLiteral", () => {
  describe("null and undefined", () => {
    test("returns NULL for null", () => {
      expect(pgLiteral(null)).toBe("NULL");
    });

    test("returns NULL for undefined", () => {
      expect(pgLiteral(undefined)).toBe("NULL");
    });
  });

  describe("booleans", () => {
    test("returns 't' for true", () => {
      expect(pgLiteral(true)).toBe("'t'");
    });

    test("returns 'f' for false", () => {
      expect(pgLiteral(false)).toBe("'f'");
    });
  });

  describe("numbers", () => {
    test("returns unquoted integers", () => {
      expect(pgLiteral(42)).toBe("42");
      expect(pgLiteral(-100)).toBe("-100");
      expect(pgLiteral(0)).toBe("0");
    });

    test("returns unquoted floats", () => {
      expect(pgLiteral(3.14159)).toBe("3.14159");
      expect(pgLiteral(-0.001)).toBe("-0.001");
    });

    test("returns quoted NaN", () => {
      expect(pgLiteral(NaN)).toBe("'NaN'");
    });

    test("returns quoted Infinity", () => {
      expect(pgLiteral(Infinity)).toBe("'Infinity'");
      expect(pgLiteral(-Infinity)).toBe("'-Infinity'");
    });

    test("handles very large numbers", () => {
      expect(pgLiteral(9007199254740991)).toBe("9007199254740991");
    });
  });

  describe("bigint", () => {
    test("returns unquoted bigint", () => {
      expect(pgLiteral(BigInt("9223372036854775807"))).toBe(
        "9223372036854775807",
      );
      expect(pgLiteral(BigInt("-9223372036854775808"))).toBe(
        "-9223372036854775808",
      );
    });
  });

  describe("strings", () => {
    test("wraps simple strings in quotes", () => {
      expect(pgLiteral("hello")).toBe("'hello'");
    });

    test("handles empty string", () => {
      expect(pgLiteral("")).toBe("''");
    });

    test("doubles single quotes", () => {
      expect(pgLiteral("O'Reilly")).toBe("'O''Reilly'");
      expect(pgLiteral("it's")).toBe("'it''s'");
      expect(pgLiteral("''")).toBe("''''''");
    });

    test("doubles backslashes and uses E prefix", () => {
      expect(pgLiteral("C:\\path")).toBe("E'C:\\\\path'");
      expect(pgLiteral("line1\\nline2")).toBe("E'line1\\\\nline2'");
    });

    test("handles both quotes and backslashes", () => {
      expect(pgLiteral("it's a C:\\path")).toBe("E'it''s a C:\\\\path'");
    });

    test("handles unicode", () => {
      expect(pgLiteral("Hello, ")).toBe("'Hello, '");
      expect(pgLiteral("")).toBe("''");
    });

    test("handles newlines and tabs literally", () => {
      expect(pgLiteral("line1\nline2")).toBe("'line1\nline2'");
      expect(pgLiteral("col1\tcol2")).toBe("'col1\tcol2'");
    });

    test("throws on null bytes", () => {
      expect(() => pgLiteral("hello\0world")).toThrow(
        "PostgreSQL cannot store null bytes",
      );
    });
  });

  describe("Date", () => {
    test("formats date as ISO timestamp", () => {
      const date = new Date("2024-01-15T10:30:00.123Z");
      expect(pgLiteral(date)).toBe("'2024-01-15 10:30:00.123+00'");
    });

    test("handles dates at epoch", () => {
      const epoch = new Date(0);
      expect(pgLiteral(epoch)).toBe("'1970-01-01 00:00:00.000+00'");
    });
  });

  describe("Buffer/Uint8Array (bytea)", () => {
    test("formats as hex with E prefix", () => {
      const buffer = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      expect(pgLiteral(buffer)).toBe("E'\\\\xdeadbeef'");
    });

    test("handles empty buffer", () => {
      const buffer = new Uint8Array([]);
      expect(pgLiteral(buffer)).toBe("E'\\\\x'");
    });

    test("handles buffer with null bytes", () => {
      const buffer = new Uint8Array([0x00, 0x01, 0x00]);
      expect(pgLiteral(buffer)).toBe("E'\\\\x000100'");
    });
  });

  describe("arrays", () => {
    test("formats as ARRAY constructor", () => {
      expect(pgLiteral([1, 2, 3])).toBe("ARRAY[1, 2, 3]");
    });

    test("handles empty array", () => {
      expect(pgLiteral([])).toBe("ARRAY[]");
    });

    test("handles string arrays with escaping", () => {
      expect(pgLiteral(["hello", "O'Reilly"])).toBe(
        "ARRAY['hello', 'O''Reilly']",
      );
    });

    test("handles mixed type arrays", () => {
      expect(pgLiteral([1, "two", true, null])).toBe(
        "ARRAY[1, 'two', 't', NULL]",
      );
    });

    test("handles nested arrays", () => {
      expect(pgLiteral([[1, 2], [3, 4]])).toBe(
        "ARRAY[ARRAY[1, 2], ARRAY[3, 4]]",
      );
    });
  });

  describe("objects (JSON)", () => {
    test("serializes and casts to jsonb", () => {
      expect(pgLiteral({ key: "value" })).toBe("'{\"key\":\"value\"}'::jsonb");
    });

    test("handles nested objects", () => {
      const obj = { nested: { deep: true } };
      expect(pgLiteral(obj)).toBe("'{\"nested\":{\"deep\":true}}'::jsonb");
    });

    test("escapes quotes in JSON string", () => {
      const obj = { name: "O'Reilly" };
      expect(pgLiteral(obj)).toBe("'{\"name\":\"O''Reilly\"}'::jsonb");
    });
  });

  describe("edge cases", () => {
    test("handles string 'null'", () => {
      expect(pgLiteral("null")).toBe("'null'");
    });

    test("handles string 'NULL'", () => {
      expect(pgLiteral("NULL")).toBe("'NULL'");
    });

    test("handles numeric strings", () => {
      expect(pgLiteral("123")).toBe("'123'");
    });

    test("handles string with only quotes", () => {
      expect(pgLiteral("'")).toBe("''''");
    });

    test("handles string with only backslash", () => {
      expect(pgLiteral("\\")).toBe("E'\\\\'");
    });
  });
});
