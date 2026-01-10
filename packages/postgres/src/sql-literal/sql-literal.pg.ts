/**
 * PostgreSQL SQL literal escaping.
 *
 * Converts JavaScript values to safe SQL literal strings that can be embedded
 * directly in SQL queries. Follows PostgreSQL's `quote_literal()` behavior.
 *
 * Use this when you need to bypass parameterized queries due to ORM limitations
 * (e.g., Prisma's `$queryRawUnsafe`, Drizzle's internal client access).
 *
 * **Security note**: Parameterized queries remain the preferred approach.
 * This function is an escape valve for ORM compatibility.
 *
 * @example
 * ```typescript
 * import { pgLiteral } from "@queuert/postgres";
 *
 * const name = "O'Reilly";
 * const sql = `SELECT * FROM users WHERE name = ${pgLiteral(name)}`;
 * // SELECT * FROM users WHERE name = 'O''Reilly'
 * ```
 */

/**
 * Escapes a JavaScript value as a PostgreSQL literal string.
 *
 * Escaping rules (following `quote_literal()` behavior):
 * - `null`/`undefined`: Returns `NULL` (unquoted keyword)
 * - `boolean`: Returns `'t'` or `'f'`
 * - `number`: Returns unquoted number, except `NaN`/`Infinity` which are quoted strings
 * - `bigint`: Returns unquoted number string
 * - `string`: Doubles single quotes. If backslashes present, doubles them and uses `E''` syntax
 * - `Date`: Returns ISO timestamp string
 * - `Buffer`/`Uint8Array`: Returns bytea hex format `E'\\x...'`
 * - `Array`: Returns `ARRAY[...]` with recursively escaped elements
 * - `object`: Returns JSON string with `::jsonb` cast
 *
 * @throws {Error} If string contains null bytes (PostgreSQL rejects them in text types)
 */
export function pgLiteral(value: unknown): string {
  // 1. Handle null/undefined
  if (value === null || value === undefined) {
    return "NULL";
  }

  // 2. Handle booleans
  if (typeof value === "boolean") {
    return value ? "'t'" : "'f'";
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
    // Convert to ISO format: '2024-01-15 10:30:00.123+00'
    // PostgreSQL accepts ISO 8601, but we format it to PostgreSQL's preferred style
    const iso = value.toISOString();
    // Replace 'T' with space and 'Z' with '+00'
    const formatted = iso.replace("T", " ").replace("Z", "+00");
    return "'" + formatted + "'";
  }

  // 6. Handle Buffer/Uint8Array (bytea)
  if (value instanceof Uint8Array) {
    const hex = bufferToHex(value);
    return "E'\\\\x" + hex + "'";
  }

  // 7. Handle arrays
  if (Array.isArray(value)) {
    return "ARRAY[" + value.map(pgLiteral).join(", ") + "]";
  }

  // 8. Handle objects (as JSON)
  if (typeof value === "object") {
    return pgLiteral(JSON.stringify(value)) + "::jsonb";
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

  throw new Error("Unable to convert value to PostgreSQL literal");
}

/**
 * Escapes a string value for PostgreSQL.
 * - Doubles single quotes
 * - If backslashes present, doubles them and prefixes with E
 * - Rejects null bytes (PostgreSQL cannot store them in text types)
 */
function escapeString(str: string): string {
  // Check for null bytes (PostgreSQL rejects them)
  if (str.includes("\0")) {
    throw new Error(
      "PostgreSQL cannot store null bytes in text types. " +
        "Remove null bytes or use bytea type instead.",
    );
  }

  let hasBackslash = false;
  let result = "'";

  for (const char of str) {
    if (char === "'") {
      result += "''";
    } else if (char === "\\") {
      result += "\\\\";
      hasBackslash = true;
    } else {
      result += char;
    }
  }

  result += "'";

  // Prepend E if backslashes were escaped
  if (hasBackslash) {
    result = "E" + result;
  }

  return result;
}

/**
 * Converts a Uint8Array to a lowercase hex string.
 */
function bufferToHex(buffer: Uint8Array): string {
  let hex = "";
  for (const byte of buffer) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
