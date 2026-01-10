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
 */
export function sqliteLiteral(value: unknown): string {
  // 1. Handle null/undefined
  if (value === null || value === undefined) {
    return "NULL";
  }

  // 2. Handle booleans (SQLite uses 0/1)
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  // 3. Handle numbers
  if (typeof value === "number") {
    // SQLite doesn't support NaN or Infinity - return NULL
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return "NULL";
    }
    return String(value);
  }

  // 4. Handle BigInt
  if (typeof value === "bigint") {
    return String(value);
  }

  // 5. Handle Date (store as ISO string)
  if (value instanceof Date) {
    return "'" + value.toISOString() + "'";
  }

  // 6. Handle Buffer/Uint8Array (blob)
  if (value instanceof Uint8Array) {
    const hex = bufferToHex(value);
    return "X'" + hex + "'";
  }

  // 7. Handle arrays (as JSON)
  if (Array.isArray(value)) {
    return escapeString(JSON.stringify(value));
  }

  // 8. Handle objects (as JSON)
  if (typeof value === "object") {
    return escapeString(JSON.stringify(value));
  }

  // 9. Handle strings (explicit check for type safety)
  if (typeof value === "string") {
    return escapeString(value);
  }

  // 10. Handle symbols as their string representation
  if (typeof value === "symbol") {
    return escapeString(value.toString());
  }

  // 11. Handle functions as their string representation
  if (typeof value === "function") {
    return escapeString(value.toString());
  }

  throw new Error("Unable to convert value to SQLite literal");
}

/**
 * Escapes a string value for SQLite.
 * - Only doubles single quotes (backslashes are NOT special in SQLite)
 * - Rejects null bytes (undefined behavior in SQLite TEXT columns)
 */
function escapeString(str: string): string {
  // Check for null bytes (undefined behavior in SQLite TEXT)
  if (str.includes("\0")) {
    throw new Error(
      "SQLite has undefined behavior with null bytes in TEXT columns. " +
        "Remove null bytes or use BLOB type instead.",
    );
  }

  // SQLite only needs single quotes doubled - backslashes are literal
  return "'" + str.replace(/'/g, "''") + "'";
}

/**
 * Converts a Uint8Array to an uppercase hex string (SQLite convention).
 */
function bufferToHex(buffer: Uint8Array): string {
  let hex = "";
  for (const byte of buffer) {
    hex += byte.toString(16).padStart(2, "0").toUpperCase();
  }
  return hex;
}
