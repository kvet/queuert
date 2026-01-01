// SQLite error codes that indicate transient issues
const TRANSIENT_SQLITE_ERROR_CODES = new Set([
  "SQLITE_BUSY", // Database is locked
  "SQLITE_LOCKED", // Table is locked
  "SQLITE_IOERR", // I/O error
]);

// Node.js network error codes (for remote SQLite or edge cases)
const TRANSIENT_NODE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "EAI_AGAIN",
]);

export const isTransientSqliteError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const err = error as Error & { code?: string };

  // Check SQLite-specific errors
  if (err.code && TRANSIENT_SQLITE_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Check Node.js network errors
  if (err.code && TRANSIENT_NODE_ERROR_CODES.has(err.code)) {
    return true;
  }

  // better-sqlite3 specific error messages
  if (err.message?.includes("database is locked")) {
    return true;
  }

  if (err.message?.includes("SQLITE_BUSY")) {
    return true;
  }

  return false;
};
