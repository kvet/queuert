import { describe, expect, test } from "vitest";
import { isTransientPgError } from "./errors.js";

describe("isTransientPgError", () => {
  test("identifies Node.js network errors as transient", () => {
    const testCases = [
      { code: "ECONNREFUSED", desc: "connection refused" },
      { code: "ECONNRESET", desc: "connection reset" },
      { code: "ETIMEDOUT", desc: "timeout" },
      { code: "ENOTFOUND", desc: "DNS not found" },
      { code: "ENETUNREACH", desc: "network unreachable" },
      { code: "EHOSTUNREACH", desc: "host unreachable" },
      { code: "EPIPE", desc: "broken pipe" },
      { code: "EAI_AGAIN", desc: "DNS temporary failure" },
    ];

    for (const { code, desc } of testCases) {
      const error = new Error(desc) as Error & { code: string };
      error.code = code;
      expect(isTransientPgError(error), `${code} should be transient`).toBe(true);
    }
  });

  test("identifies PostgreSQL connection errors as transient", () => {
    const testCases = [
      { code: "08000", desc: "connection_exception" },
      { code: "08003", desc: "connection_does_not_exist" },
      { code: "08006", desc: "connection_failure" },
      { code: "08001", desc: "sqlclient_unable_to_establish_sqlconnection" },
      { code: "08004", desc: "sqlserver_rejected_establishment_of_sqlconnection" },
    ];

    for (const { code, desc } of testCases) {
      const error = new Error(desc) as Error & { code: string };
      error.code = code;
      expect(isTransientPgError(error), `${code} should be transient`).toBe(true);
    }
  });

  test("identifies PostgreSQL operator intervention errors as transient", () => {
    const testCases = [
      { code: "57000", desc: "operator_intervention" },
      { code: "57014", desc: "query_canceled" },
      { code: "57P01", desc: "admin_shutdown" },
      { code: "57P02", desc: "crash_shutdown" },
      { code: "57P03", desc: "cannot_connect_now" },
    ];

    for (const { code, desc } of testCases) {
      const error = new Error(desc) as Error & { code: string };
      error.code = code;
      expect(isTransientPgError(error), `${code} should be transient`).toBe(true);
    }
  });

  test("identifies constraint violations as non-transient", () => {
    const testCases = [
      { code: "23505", desc: "unique_violation" },
      { code: "23503", desc: "foreign_key_violation" },
      { code: "23502", desc: "not_null_violation" },
      { code: "23514", desc: "check_violation" },
    ];

    for (const { code, desc } of testCases) {
      const error = new Error(desc) as Error & { code: string };
      error.code = code;
      expect(isTransientPgError(error), `${code} should NOT be transient`).toBe(false);
    }
  });

  test("identifies syntax errors as non-transient", () => {
    const error = new Error("syntax error") as Error & { code: string };
    error.code = "42601";
    expect(isTransientPgError(error)).toBe(false);
  });

  test("handles non-Error values", () => {
    expect(isTransientPgError(null)).toBe(false);
    expect(isTransientPgError(undefined)).toBe(false);
    expect(isTransientPgError("string error")).toBe(false);
    expect(isTransientPgError(123)).toBe(false);
    expect(isTransientPgError({})).toBe(false);
  });

  test("handles errors without code", () => {
    expect(isTransientPgError(new Error("generic error"))).toBe(false);
  });

  test("handles errors with non-string code", () => {
    const error = new Error("error") as Error & { code: number };
    error.code = 123;
    expect(isTransientPgError(error)).toBe(false);
  });
});
