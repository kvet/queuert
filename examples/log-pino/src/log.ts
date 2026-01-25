import { type Logger } from "pino";
import { type Log } from "queuert";

/**
 * Creates a queuert Log adapter for Pino.
 *
 * Handles error serialization properly - Pino expects errors in the `err` property
 * for proper stack trace formatting and serialization.
 */
export const createPinoLog = (logger: Logger): Log => {
  return (entry) => {
    const { type, level, message, data } = entry;
    const error = "error" in entry ? entry.error : undefined;

    // Pino uses 'err' property for proper error serialization
    if (error !== undefined) {
      logger[level]({ type, ...data, err: error }, message);
    } else {
      logger[level]({ type, ...data }, message);
    }
  };
};
