// MongoDB server error codes that indicate transient issues
const TRANSIENT_MONGO_ERROR_CODES = new Set([
  10107, // NotWritablePrimary
  11600, // InterruptedAtShutdown
  11602, // InterruptedDueToReplStateChange
  13436, // NotPrimaryOrSecondary
  189, // PrimarySteppedDown
  91, // ShutdownInProgress
  50, // MaxTimeMSExpired (query timeout)
]);

// Node.js network error codes
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

export const isTransientMongoError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const err = error as Error & { code?: number | string; name?: string };

  // Check MongoDB-specific error names
  if (err.name === "MongoNetworkError" || err.name === "MongoNetworkTimeoutError") {
    return true;
  }

  if (err.name === "MongoTimeoutError") {
    return true;
  }

  // Check MongoDB server error codes
  if (typeof err.code === "number" && TRANSIENT_MONGO_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Check Node.js network errors
  if (typeof err.code === "string" && TRANSIENT_NODE_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Check error message patterns
  if (err.message?.includes("connection") && err.message?.includes("closed")) {
    return true;
  }

  if (err.message?.includes("topology was destroyed")) {
    return true;
  }

  return false;
};
