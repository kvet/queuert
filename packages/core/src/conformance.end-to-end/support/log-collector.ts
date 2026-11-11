import type { Log } from "../../observability-adapter/log.ts";

type LogEntry = Parameters<Log>[0];

export const createLogCollector = (): {
  log: Log;
  entriesOfType: <TType extends LogEntry["type"]>(
    type: TType,
  ) => Extract<LogEntry, { type: TType }>[];
} => {
  const entries: LogEntry[] = [];
  return {
    log: (entry) => {
      entries.push(entry);
    },
    entriesOfType: <TType extends LogEntry["type"]>(type: TType) =>
      entries.filter((entry): entry is Extract<LogEntry, { type: TType }> => entry.type === type),
  };
};
