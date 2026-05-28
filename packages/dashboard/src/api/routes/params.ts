import { type ChainStatus, type JobStatus } from "queuert";
import { decodeCreatedAtWithIdCursor, decodeIdCursor } from "queuert/internal";

const VALID_JOB_STATUSES = new Set<string>([
  "blocked",
  "scheduled",
  "ready",
  "running",
  "succeeded",
  "completed",
]);

const VALID_CHAIN_STATUSES = new Set<string>(["open", "closed"]);

export const parseTypeNameFilter = (raw: string | undefined): string[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
};

export const parseStatusFilter = (raw: string | undefined): JobStatus[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter((v) => VALID_JOB_STATUSES.has(v));
  return values.length > 0 ? (values as JobStatus[]) : undefined;
};

export const parseChainStatusFilter = (raw: string | undefined): ChainStatus[] | undefined => {
  if (!raw) return undefined;
  const values = raw.split(",").filter((v) => VALID_CHAIN_STATUSES.has(v));
  return values.length > 0 ? (values as ChainStatus[]) : undefined;
};

export const parseCursor = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  try {
    decodeCreatedAtWithIdCursor(raw);
    return raw;
  } catch {}
  try {
    decodeIdCursor(raw);
    return raw;
  } catch {
    return undefined;
  }
};

export const parseLimit = (raw: string | undefined): number => {
  const n = Number(raw);
  return Math.min(n > 0 ? Math.floor(n) : 50, 100);
};
