// MySQL error codes that indicate transient issues
// See: https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html
const TRANSIENT_MYSQL_ERROR_CODES = new Set([
  1040, // ER_CON_COUNT_ERROR: Too many connections
  1205, // ER_LOCK_WAIT_TIMEOUT: Lock wait timeout exceeded
  1213, // ER_LOCK_DEADLOCK: Deadlock found when trying to get lock
  1317, // ER_QUERY_INTERRUPTED: Query execution was interrupted
  2002, // CR_CONNECTION_ERROR: Can't connect to local MySQL server through socket
  2003, // CR_CONN_HOST_ERROR: Can't connect to MySQL server
  2006, // CR_SERVER_GONE_ERROR: MySQL server has gone away
  2013, // CR_SERVER_LOST: Lost connection to MySQL server during query
  2055, // CR_SERVER_LOST_EXTENDED: Lost connection to MySQL server
]);

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

export const isTransientMysqlError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const err = error as Error & { code?: string | number; errno?: number };

  // Check MySQL-specific error numbers (errno)
  if (typeof err.errno === "number" && TRANSIENT_MYSQL_ERROR_CODES.has(err.errno)) {
    return true;
  }

  // Check numeric code property (some MySQL drivers use this)
  if (typeof err.code === "number" && TRANSIENT_MYSQL_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Check Node.js network errors
  if (typeof err.code === "string" && TRANSIENT_NODE_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Check common MySQL error message patterns
  if (err.message?.includes("Connection lost")) {
    return true;
  }

  if (err.message?.includes("ECONNREFUSED")) {
    return true;
  }

  if (err.message?.includes("server has gone away")) {
    return true;
  }

  return false;
};
