import { type StateJobStatus } from "queuert";
import { decodeCursor } from "queuert/internal";

const VALID_STATUSES = new Set<string>(["blocked", "pending", "running", "completed"]);

export const parseTypeNameFilter = (raw: string | undefined): string[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
};

export const parseStatusFilter = (raw: string | undefined): StateJobStatus[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter((v) => VALID_STATUSES.has(v));
  return values.length > 0 ? (values as StateJobStatus[]) : undefined;
};

export const parseCursor = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  try {
    decodeCursor(raw);
    return raw;
  } catch {
    return undefined;
  }
};

export const parseLimit = (raw: string | undefined): number => Math.min(Number(raw) || 50, 100);
