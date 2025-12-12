// Node.js network error codes that indicate transient connection issues
const TRANSIENT_NODE_ERROR_CODES = new Set([
  "ECONNREFUSED", // Connection refused (server not listening)
  "ECONNRESET", // Connection reset by peer
  "ETIMEDOUT", // Connection timed out
  "ENOTFOUND", // DNS lookup failed
  "ENETUNREACH", // Network unreachable
  "EHOSTUNREACH", // Host unreachable
  "EPIPE", // Broken pipe
  "EAI_AGAIN", // DNS temporary failure
]);

// PostgreSQL SQLSTATE classes for transient errors
// See: https://www.postgresql.org/docs/current/errcodes-appendix.html
const TRANSIENT_PG_ERROR_CLASS_PREFIXES = new Set([
  "08", // Connection Exception (connection_exception, connection_failure, etc.)
  "57", // Operator Intervention (admin_shutdown, crash_shutdown, cannot_connect_now)
]);

export const isTransientPgError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const err = error as Error & { code?: string };

  // Check Node.js network errors
  if (err.code && TRANSIENT_NODE_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Check PostgreSQL SQLSTATE codes (5-character codes like '08000', '57P01')
  if (err.code && typeof err.code === "string" && err.code.length === 5) {
    const prefix = err.code.substring(0, 2);
    if (TRANSIENT_PG_ERROR_CLASS_PREFIXES.has(prefix)) {
      return true;
    }
  }

  return false;
};
