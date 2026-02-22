import { type Job, type SerializedJob, deserializeJob } from "../shared/job.js";

export type { Job } from "../shared/job.js";

const BASE = "./api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

const deserializeJobOrNull = (raw: SerializedJob | null): Job | null =>
  raw ? deserializeJob(raw) : null;

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export const listChains = async (
  params: {
    typeName?: string;
    rootOnly?: boolean;
    id?: string;
    cursor?: string;
    limit?: number;
  } = {},
): Promise<PageResult<[Job, Job | null]>> => {
  const qs = new URLSearchParams();
  if (params.typeName) qs.set("typeName", params.typeName);
  if (params.rootOnly === false) qs.set("rootOnly", "false");
  if (params.id) qs.set("id", params.id);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  const raw = await fetchJson<PageResult<[SerializedJob, SerializedJob | null]>>(
    `/chains${q ? `?${q}` : ""}`,
  );
  return {
    ...raw,
    items: raw.items.map(([root, last]) => [deserializeJob(root), deserializeJobOrNull(last)]),
  };
};

export const listJobs = async (
  params: {
    status?: string;
    typeName?: string;
    chainId?: string;
    id?: string;
    cursor?: string;
    limit?: number;
  } = {},
): Promise<PageResult<Job>> => {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.typeName) qs.set("typeName", params.typeName);
  if (params.chainId) qs.set("chainId", params.chainId);
  if (params.id) qs.set("id", params.id);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  const raw = await fetchJson<PageResult<SerializedJob>>(`/jobs${q ? `?${q}` : ""}`);
  return { ...raw, items: raw.items.map(deserializeJob) };
};

export const getChainDetail = async (
  chainId: string,
): Promise<{
  rootJob: Job;
  lastJob: Job | null;
  jobs: Job[];
  jobBlockers: Record<string, [Job, Job | null][]>;
}> => {
  const raw = await fetchJson<{
    rootJob: SerializedJob;
    lastJob: SerializedJob | null;
    jobs: SerializedJob[];
    jobBlockers: Record<string, [SerializedJob, SerializedJob | null][]>;
  }>(`/chains/${chainId}`);
  return {
    rootJob: deserializeJob(raw.rootJob),
    lastJob: deserializeJobOrNull(raw.lastJob),
    jobs: raw.jobs.map(deserializeJob),
    jobBlockers: Object.fromEntries(
      Object.entries(raw.jobBlockers).map(
        ([k, v]) =>
          [
            k,
            v.map(
              ([root, last]) =>
                [deserializeJob(root), deserializeJobOrNull(last)] as [Job, Job | null],
            ),
          ] as const,
      ),
    ),
  };
};

export const getChainBlocking = async (chainId: string): Promise<{ items: Job[] }> => {
  const raw = await fetchJson<{ items: SerializedJob[] }>(`/chains/${chainId}/blocking`);
  return { items: raw.items.map(deserializeJob) };
};

export const getJobDetail = async (
  jobId: string,
): Promise<{
  job: Job;
  continuation: Job | null;
  blockers: [Job, Job | null][];
}> => {
  const raw = await fetchJson<{
    job: SerializedJob;
    continuation: SerializedJob | null;
    blockers: [SerializedJob, SerializedJob | null][];
  }>(`/jobs/${jobId}`);
  return {
    job: deserializeJob(raw.job),
    continuation: deserializeJobOrNull(raw.continuation),
    blockers: raw.blockers.map(([root, last]) => [
      deserializeJob(root),
      deserializeJobOrNull(last),
    ]),
  };
};
