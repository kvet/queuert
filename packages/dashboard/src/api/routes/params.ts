import { type ChainStatus, type JobStatus } from "queuert";
import { decodeIdCursor, decodeTimestampWithIdCursor } from "queuert/internal";

const VALID_JOB_STATUSES = new Set<string>(["pending", "running", "completed"]);
const VALID_CHAIN_STATUSES = new Set<string>(["running", "completed"]);

export const parseChainStatusFilter = (raw: string | undefined): ChainStatus | undefined => {
  if (!raw) return undefined;
  return VALID_CHAIN_STATUSES.has(raw) ? (raw as ChainStatus) : undefined;
};

export const parseJobStatusFilter = (
  raw: string | undefined,
): { status?: JobStatus; blocked?: boolean; continued?: boolean } => {
  if (!raw) return {};
  if (raw === "blocked") return { status: "pending", blocked: true };
  if (raw === "pending-unblocked") return { status: "pending", blocked: false };
  if (raw === "completed-terminal") return { status: "completed", continued: false };
  if (raw === "completed-continued") return { status: "completed", continued: true };
  if (VALID_JOB_STATUSES.has(raw)) return { status: raw as JobStatus };
  return {};
};

export const parseCursor = (
  raw: string | undefined,
  expected: { type: "id" } | { type: "timestampWithId"; sortKey: string },
): string | undefined => {
  if (!raw) return undefined;
  try {
    if (expected.type === "id") {
      decodeIdCursor(raw);
    } else {
      decodeTimestampWithIdCursor(raw, expected.sortKey);
    }
    return raw;
  } catch {
    return undefined;
  }
};

export const parseLimit = (raw: string | undefined): number => {
  const n = Number(raw);
  return Math.min(n > 0 ? Math.floor(n) : 50, 100);
};

export const parseOrderBy = <T extends string>(
  raw: string | undefined,
  validValues: readonly [T, ...T[]],
): T => {
  if (raw && validValues.includes(raw as T)) return raw as T;
  return validValues[0];
};

export const parseOrderDirection = (raw: string | undefined): "asc" | "desc" => {
  if (raw === "asc") return "asc";
  return "desc";
};
