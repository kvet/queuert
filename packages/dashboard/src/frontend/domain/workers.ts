import type { CappedCount } from "./counts.ts";

export type JobLease =
  | { state: "live"; leaseUntil: Date }
  | { state: "expired" }
  | { state: "gone" };

export const jobLease = (worker: { leaseUntil: Date; expired: boolean } | null): JobLease =>
  worker === null
    ? { state: "gone" }
    : worker.expired
      ? { state: "expired" }
      : { state: "live", leaseUntil: worker.leaseUntil };

export type TypeWorkers = { live: number; expired: number; stranded: boolean };

export const isStrandedType = (counts: {
  pending: CappedCount;
  liveWorkerCount: number;
}): boolean => counts.pending.count > 0 && counts.liveWorkerCount === 0;

export const decodeWorkerId = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};
