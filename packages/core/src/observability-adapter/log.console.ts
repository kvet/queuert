import { type Log } from "./log.js";

/**
 * Create a {@link Log} implementation that writes to `console`.
 *
 * Output format: `[ISO timestamp] [LEVEL] [type] message data [error]`
 */
export const createConsoleLog = (): Log => {
  return (entry) => {
    const { type, level, message, data } = entry;
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${type}] ${message}`;
    if ("error" in entry) {
      console[level](prefix, data, entry.error);
    } else {
      console[level](prefix, data);
    }
  };
};
