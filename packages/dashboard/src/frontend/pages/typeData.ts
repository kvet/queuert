import { CHAIN_STATUSES, JOB_STATUSES } from "@queuert/ui/lib";
import { type ChainStatus, type JobStatus } from "queuert";

import {
  countByChainTypeNames,
  countByJobTypeNames,
  listChainTypeNames,
  listJobTypeNames,
} from "../api.js";
import { type CappedCount } from "../domain/counts.js";

const COUNT_CHUNK = 50;

export type TypeEntry<TStatus extends string> = {
  typeName: string;
  counts: { status: TStatus; count: CappedCount }[];
};

const chunked = async <T>(
  names: string[],
  count: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> => {
  const results: T[] = [];
  for (let start = 0; start < names.length; start += COUNT_CHUNK) {
    results.push(...(await count(names.slice(start, start + COUNT_CHUNK))));
  }
  return results;
};

export const toStatusCounts = <TStatus extends string>(
  statuses: TStatus[],
  entry: Record<TStatus, CappedCount>,
): { status: TStatus; count: CappedCount }[] =>
  statuses.map((status) => ({ status, count: entry[status] }));

export const loadChainTypes = async (signal: AbortSignal): Promise<TypeEntry<ChainStatus>[]> => {
  const names = await listChainTypeNames({ signal });
  const counts = await chunked(names, async (chunk) => countByChainTypeNames(chunk, { signal }));
  return counts.map((entry) => ({
    typeName: entry.typeName,
    counts: toStatusCounts(CHAIN_STATUSES, entry),
  }));
};

export const loadJobTypes = async (signal: AbortSignal): Promise<TypeEntry<JobStatus>[]> => {
  const names = await listJobTypeNames({ signal });
  const counts = await chunked(names, async (chunk) => countByJobTypeNames(chunk, { signal }));
  return counts.map((entry) => ({
    typeName: entry.typeName,
    counts: toStatusCounts(JOB_STATUSES, entry),
  }));
};

export const countOf = <TStatus extends string>(
  entry: TypeEntry<TStatus>,
  statuses: readonly TStatus[],
): number =>
  entry.counts
    .filter((statusCount) => statuses.includes(statusCount.status))
    .reduce((sum, statusCount) => sum + statusCount.count.count, 0);

export const narrowToStatuses = <TStatus extends string>(
  entries: TypeEntry<TStatus>[],
  statuses: readonly TStatus[],
): TypeEntry<TStatus>[] =>
  entries
    .map((entry) => ({
      typeName: entry.typeName,
      counts: entry.counts.filter((statusCount) => statuses.includes(statusCount.status)),
    }))
    .filter((entry) => entry.counts.some((statusCount) => statusCount.count.count > 0));

export const typeListHref = (
  base: "/chains" | "/jobs",
  typeName: string,
  status?: string,
): string => `${base}?typeName=${encodeURIComponent(typeName)}${status ? `&status=${status}` : ""}`;
