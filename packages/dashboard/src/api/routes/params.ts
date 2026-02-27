import { type JobStatus } from "queuert";
import { decodeChainIndexCursor, decodeCreatedAtCursor } from "queuert/internal";

const VALID_STATUSES = new Set<string>(["blocked", "pending", "running", "completed"]);

export const parseTypeNameFilter = (raw: string | undefined): string[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
};

export const parseStatusFilter = (raw: string | undefined): JobStatus[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter((v) => VALID_STATUSES.has(v));
  return values.length > 0 ? (values as JobStatus[]) : undefined;
};

export const parseCursor = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  try {
    decodeCreatedAtCursor(raw);
    return raw;
  } catch {}
  try {
    decodeChainIndexCursor(raw);
    return raw;
  } catch {
    return undefined;
  }
};

export const parseLimit = (raw: string | undefined): number => {
  const n = Number(raw);
  return Math.min(n > 0 ? Math.floor(n) : 50, 100);
};
