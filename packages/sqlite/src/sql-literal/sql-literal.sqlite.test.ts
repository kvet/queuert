import { describe, expect, test } from "vitest";
import { sqliteLiteral } from "./sql-literal.sqlite.js";

describe("sqliteLiteral", () => {
  describe("null and undefined", () => {
    test("returns NULL for null", () => {
      expect(sqliteLiteral(null)).toBe("NULL");
    });

    test("returns NULL for undefined", () => {
      expect(sqliteLiteral(undefined)).toBe("NULL");
    });
  });

  describe("booleans", () => {
    test("returns 1 for true", () => {
      expect(sqliteLiteral(true)).toBe("1");
    });

    test("returns 0 for false", () => {
      expect(sqliteLiteral(false)).toBe("0");
    });
  });

  describe("numbers", () => {
    test("returns unquoted integers", () => {
      expect(sqliteLiteral(42)).toBe("42");
      expect(sqliteLiteral(-100)).toBe("-100");
      expect(sqliteLiteral(0)).toBe("0");
    });

    test("returns unquoted floats", () => {
      expect(sqliteLiteral(3.14159)).toBe("3.14159");
      expect(sqliteLiteral(-0.001)).toBe("-0.001");
    });

    test("returns NULL for NaN (not supported in SQLite)", () => {
      expect(sqliteLiteral(NaN)).toBe("NULL");
    });

    test("returns NULL for Infinity (not supported in SQLite)", () => {
      expect(sqliteLiteral(Infinity)).toBe("NULL");
      expect(sqliteLiteral(-Infinity)).toBe("NULL");
    });

    test("handles very large numbers", () => {
      expect(sqliteLiteral(9007199254740991)).toBe("9007199254740991");
    });
  });

  describe("bigint", () => {
    test("returns unquoted bigint", () => {
      expect(sqliteLiteral(BigInt("9223372036854775807"))).toBe(
        "9223372036854775807",
      );
      expect(sqliteLiteral(BigInt("-9223372036854775808"))).toBe(
        "-9223372036854775808",
      );
    });
  });

  describe("strings", () => {
    test("wraps simple strings in quotes", () => {
      expect(sqliteLiteral("hello")).toBe("'hello'");
    });

    test("handles empty string", () => {
      expect(sqliteLiteral("")).toBe("''");
    });

    test("doubles single quotes", () => {
      expect(sqliteLiteral("O'Reilly")).toBe("'O''Reilly'");
      expect(sqliteLiteral("it's")).toBe("'it''s'");
      expect(sqliteLiteral("''")).toBe("''''''");
    });

    test("does NOT escape backslashes (SQLite treats them literally)", () => {
      expect(sqliteLiteral("C:\\path")).toBe("'C:\\path'");
      expect(sqliteLiteral("line1\\nline2")).toBe("'line1\\nline2'");
    });

    test("handles both quotes and backslashes", () => {
      // Backslash is literal, only quote is escaped
      expect(sqliteLiteral("it's a C:\\path")).toBe("'it''s a C:\\path'");
    });

    test("handles unicode", () => {
      expect(sqliteLiteral("Hello, ")).toBe("'Hello, '");
      expect(sqliteLiteral("")).toBe("''");
    });

    test("handles newlines and tabs literally", () => {
      expect(sqliteLiteral("line1\nline2")).toBe("'line1\nline2'");
      expect(sqliteLiteral("col1\tcol2")).toBe("'col1\tcol2'");
    });

    test("throws on null bytes", () => {
      expect(() => sqliteLiteral("hello\0world")).toThrow(
        "undefined behavior with null bytes",
      );
    });
  });

  describe("Date", () => {
    test("formats date as ISO string", () => {
      const date = new Date("2024-01-15T10:30:00.123Z");
      expect(sqliteLiteral(date)).toBe("'2024-01-15T10:30:00.123Z'");
    });

    test("handles dates at epoch", () => {
      const epoch = new Date(0);
      expect(sqliteLiteral(epoch)).toBe("'1970-01-01T00:00:00.000Z'");
    });
  });

  describe("Buffer/Uint8Array (blob)", () => {
    test("formats as hex with X prefix (uppercase)", () => {
      const buffer = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      expect(sqliteLiteral(buffer)).toBe("X'DEADBEEF'");
    });

    test("handles empty buffer", () => {
      const buffer = new Uint8Array([]);
      expect(sqliteLiteral(buffer)).toBe("X''");
    });

    test("handles buffer with null bytes", () => {
      const buffer = new Uint8Array([0x00, 0x01, 0x00]);
      expect(sqliteLiteral(buffer)).toBe("X'000100'");
    });
  });

  describe("arrays", () => {
    test("serializes as JSON string", () => {
      expect(sqliteLiteral([1, 2, 3])).toBe("'[1,2,3]'");
    });

    test("handles empty array", () => {
      expect(sqliteLiteral([])).toBe("'[]'");
    });

    test("handles string arrays with escaping", () => {
      expect(sqliteLiteral(["hello", "O'Reilly"])).toBe(
        "'[\"hello\",\"O''Reilly\"]'",
      );
    });

    test("handles nested arrays", () => {
      expect(sqliteLiteral([[1, 2], [3, 4]])).toBe("'[[1,2],[3,4]]'");
    });
  });

  describe("objects (JSON)", () => {
    test("serializes as JSON string (no cast)", () => {
      expect(sqliteLiteral({ key: "value" })).toBe("'{\"key\":\"value\"}'");
    });

    test("handles nested objects", () => {
      const obj = { nested: { deep: true } };
      expect(sqliteLiteral(obj)).toBe("'{\"nested\":{\"deep\":true}}'");
    });

    test("escapes quotes in JSON string", () => {
      const obj = { name: "O'Reilly" };
      expect(sqliteLiteral(obj)).toBe("'{\"name\":\"O''Reilly\"}'");
    });
  });

  describe("edge cases", () => {
    test("handles string 'null'", () => {
      expect(sqliteLiteral("null")).toBe("'null'");
    });

    test("handles string 'NULL'", () => {
      expect(sqliteLiteral("NULL")).toBe("'NULL'");
    });

    test("handles numeric strings", () => {
      expect(sqliteLiteral("123")).toBe("'123'");
    });

    test("handles string with only quotes", () => {
      expect(sqliteLiteral("'")).toBe("''''");
    });

    test("handles string with only backslash (literal)", () => {
      expect(sqliteLiteral("\\")).toBe("'\\'");
    });
  });

  describe("differences from PostgreSQL", () => {
    test("backslash handling differs", () => {
      // PostgreSQL: E'C:\\path' (escaped, with E prefix)
      // SQLite: 'C:\path' (literal, no escaping)
      expect(sqliteLiteral("C:\\path")).toBe("'C:\\path'");
    });

    test("boolean handling differs", () => {
      // PostgreSQL: 't' and 'f'
      // SQLite: 1 and 0
      expect(sqliteLiteral(true)).toBe("1");
      expect(sqliteLiteral(false)).toBe("0");
    });

    test("NaN/Infinity handling differs", () => {
      // PostgreSQL: 'NaN' and 'Infinity' (quoted strings)
      // SQLite: NULL (not supported)
      expect(sqliteLiteral(NaN)).toBe("NULL");
      expect(sqliteLiteral(Infinity)).toBe("NULL");
    });

    test("blob hex format differs", () => {
      // PostgreSQL: E'\\xDEADBEEF' (lowercase)
      // SQLite: X'DEADBEEF' (uppercase)
      const buffer = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      expect(sqliteLiteral(buffer)).toBe("X'DEADBEEF'");
    });

    test("array handling differs", () => {
      // PostgreSQL: ARRAY[1, 2, 3]
      // SQLite: '[1,2,3]' (JSON string)
      expect(sqliteLiteral([1, 2, 3])).toBe("'[1,2,3]'");
    });

    test("object handling differs", () => {
      // PostgreSQL: '{"key":"value"}'::jsonb
      // SQLite: '{"key":"value"}' (no cast)
      expect(sqliteLiteral({ key: "value" })).toBe("'{\"key\":\"value\"}'");
    });
  });
});
