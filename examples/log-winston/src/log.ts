import { type Logger } from "winston";
import { type Log } from "queuert";

/**
 * Creates a queuert Log adapter for Winston.
 *
 * Handles error serialization properly - Winston accepts errors as metadata
 * and formats them based on configured transports and formats.
 */
export const createWinstonLog = (logger: Logger): Log => {
  return (entry) => {
    const { type, level, message, data } = entry;
    const error = "error" in entry ? entry.error : undefined;

    // Winston accepts error in data object
    if (error !== undefined) {
      logger.log(level, message, { type, ...data, error });
    } else {
      logger.log(level, message, { type, ...data });
    }
  };
};
