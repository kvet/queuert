import type { Log } from "./log.js";

export const createConsoleLog = (): Log => {
  return ({ type, level, message, args }) => {
    const timestamp = new Date().toISOString();
    const logFn =
      level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    logFn(`[${timestamp}] [${level.toUpperCase()}] [${type}] ${message}`, ...args);
  };
};
