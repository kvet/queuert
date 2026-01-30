/**
 * MySQL SQL literal escaping.
 *
 * Converts JavaScript values to safe SQL literal strings that can be embedded
 * directly in SQL queries. Follows MySQL's escaping conventions.
 *
 * Use this when you need to bypass parameterized queries due to ORM limitations.
 *
 * **Security note**: Parameterized queries remain the preferred approach.
 * This function is an escape valve for ORM compatibility.
 *
 * @example
 * ```typescript
 * import { mysqlLiteral } from "@queuert/mysql";
 *
 * const name = "O'Reilly";
 * const sql = `SELECT * FROM users WHERE name = ${mysqlLiteral(name)}`;
 * // SELECT * FROM users WHERE name = 'O\'Reilly'
 * ```
 */

/**
 * Escapes a JavaScript value as a MySQL literal string.
 *
 * Escaping rules:
 * - `null`/`undefined`: Returns `NULL` (unquoted keyword)
 * - `boolean`: Returns `TRUE` or `FALSE`
 * - `number`: Returns unquoted number
 * - `bigint`: Returns unquoted number string
 * - `string`: Escapes special characters using backslash
 * - `Date`: Returns ISO datetime string in MySQL format
 * - `Buffer`/`Uint8Array`: Returns hex format `X'...'`
 * - `Array`: Returns JSON array string
 * - `object`: Returns JSON string
 *
 * @throws {Error} If string contains null bytes
 */
export function mysqlLiteral(value: unknown): string {
  // 1. Handle null/undefined
  if (value === null || value === undefined) {
    return "NULL";
  }

  // 2. Handle booleans
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  // 3. Handle numbers
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return "'NaN'";
    }
    if (!Number.isFinite(value)) {
      return value > 0 ? "'Infinity'" : "'-Infinity'";
    }
    return String(value);
  }

  // 4. Handle BigInt
  if (typeof value === "bigint") {
    return String(value);
  }

  // 5. Handle Date
  if (value instanceof Date) {
    const iso = value.toISOString();
    const formatted = iso.replace("T", " ").slice(0, -1);
    return "'" + formatted + "'";
  }

  // 6. Handle Buffer/Uint8Array (binary)
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

  // 9. Handle strings
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

  throw new Error("Unable to convert value to MySQL literal");
}

/**
 * Escapes a string value for MySQL.
 * Uses backslash escaping for special characters.
 */
function escapeString(str: string): string {
  if (str.includes("\0")) {
    throw new Error(
      "MySQL cannot safely store null bytes in text types. " +
        "Remove null bytes or use BLOB type instead.",
    );
  }

  let result = "'";

  for (const char of str) {
    switch (char) {
      case "'":
        result += "\\'";
        break;
      case '"':
        result += '\\"';
        break;
      case "\\":
        result += "\\\\";
        break;
      case "\n":
        result += "\\n";
        break;
      case "\r":
        result += "\\r";
        break;
      case "\t":
        result += "\\t";
        break;
      case "\x1a":
        result += "\\Z";
        break;
      default:
        result += char;
    }
  }

  result += "'";
  return result;
}

/**
 * Converts a Uint8Array to an uppercase hex string.
 */
function bufferToHex(buffer: Uint8Array): string {
  let hex = "";
  for (const byte of buffer) {
    hex += byte.toString(16).padStart(2, "0").toUpperCase();
  }
  return hex;
}
