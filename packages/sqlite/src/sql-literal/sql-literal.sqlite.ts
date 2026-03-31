/**
 * SQLite SQL literal escaping.
 *
 * Converts JavaScript values to safe SQL literal strings that can be embedded
 * directly in SQL queries. Follows SQLite's string literal syntax.
 *
 * Use this when you need to bypass parameterized queries due to ORM limitations.
 *
 * **Security note**: Parameterized queries remain the preferred approach.
 * This function is an escape valve for ORM compatibility.
 *
 * @example
 * ```typescript
 * import { sqliteLiteral } from "@queuert/sqlite";
 *
 * const name = "O'Reilly";
 * const sql = `SELECT * FROM users WHERE name = ${sqliteLiteral(name)}`;
 * // SELECT * FROM users WHERE name = 'O''Reilly'
 * ```
 */

/**
 * Escapes a JavaScript value as a SQLite literal string.
 *
 * Escaping rules:
 * - `null`/`undefined`: Returns `NULL` (unquoted keyword)
 * - `boolean`: Returns `1` or `0`
 * - `number`: Returns unquoted number. `NaN`/`Infinity` return `NULL` (not supported in SQLite)
 * - `bigint`: Returns unquoted number string
 * - `string`: Only doubles single quotes. Backslashes are NOT special in SQLite.
 * - `Date`: Returns ISO timestamp string
 * - `Buffer`/`Uint8Array`: Returns blob hex format `X'...'`
 * - `Array`: Returns JSON array string
 * - `object`: Returns JSON string
 *
 * @throws {Error} If string contains null bytes (causes undefined behavior in SQLite TEXT)
 * @experimental
 */
export const sqliteLiteral = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";

  if (typeof value === "boolean") return value ? "1" : "0";

  if (typeof value === "number") {
    // NaN and Infinity are not supported in SQLite
    if (Number.isNaN(value) || !Number.isFinite(value)) return "NULL";
    return String(value);
  }

  if (typeof value === "bigint") return String(value);

  if (value instanceof Date) return "'" + value.toISOString() + "'";

  if (value instanceof Uint8Array) return "X'" + bufferToHex(value) + "'";

  if (Array.isArray(value)) return escapeString(JSON.stringify(value));

  if (typeof value === "object") return escapeString(JSON.stringify(value));

  if (typeof value === "string") return escapeString(value);

  if (typeof value === "symbol") return escapeString(value.toString());

  if (typeof value === "function") return escapeString(value.toString());

  throw new Error("Unable to convert value to SQLite literal");
};

/**
 * Escapes a string value for SQLite.
 * - Only doubles single quotes (backslashes are NOT special in SQLite)
 * - Rejects null bytes (undefined behavior in SQLite TEXT columns)
 */
const escapeString = (str: string): string => {
  // Check for null bytes (undefined behavior in SQLite TEXT)
  if (str.includes("\0")) {
    throw new Error(
      "SQLite has undefined behavior with null bytes in TEXT columns. " +
        "Remove null bytes or use BLOB type instead.",
    );
  }

  // SQLite only needs single quotes doubled - backslashes are literal
  return "'" + str.replace(/'/g, "''") + "'";
};

/**
 * Converts a Uint8Array to an uppercase hex string (SQLite convention).
 */
const bufferToHex = (buffer: Uint8Array): string => {
  let hex = "";
  for (const byte of buffer) {
    hex += byte.toString(16).padStart(2, "0").toUpperCase();
  }
  return hex;
};
