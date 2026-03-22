import { type Job as CoreJob, type JobChain as CoreJobChain } from "queuert";
// @ts-expect-error tsgo doesn't resolve export * re-exports from seroval
import { deserialize } from "seroval";

export type UnknownJob = CoreJob<string, string, string, unknown, unknown>;
export type UnknownJobChain = CoreJobChain<string, string, unknown, unknown>;

const BASE = "./api";

const fetchSeroval = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, init);
  const body = deserialize<T & { error?: string }>(await res.text());
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
};

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export const listJobChains = async (
  params: {
    typeName?: string;
    status?: string;
    root?: boolean;
    id?: string;
    jobId?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<PageResult<UnknownJobChain>> => {
  const qs = new URLSearchParams();
  if (params.typeName) qs.set("typeName", params.typeName);
  if (params.status) qs.set("status", params.status);
  if (params.root === false) qs.set("root", "false");
  if (params.id) qs.set("id", params.id);
  if (params.jobId) qs.set("jobId", params.jobId);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return fetchSeroval<PageResult<UnknownJobChain>>(`/chains${q ? `?${q}` : ""}`, {
    signal: params.signal,
  });
};

export const listJobs = async (
  params: {
    status?: string;
    typeName?: string;
    chainId?: string;
    id?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<PageResult<UnknownJob>> => {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.typeName) qs.set("typeName", params.typeName);
  if (params.chainId) qs.set("chainId", params.chainId);
  if (params.id) qs.set("id", params.id);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return fetchSeroval<PageResult<UnknownJob>>(`/jobs${q ? `?${q}` : ""}`, {
    signal: params.signal,
  });
};

export const getChainDetail = async (
  chainId: string,
): Promise<{
  chain: UnknownJobChain;
  jobs: UnknownJob[];
  jobBlockers: Record<string, UnknownJobChain[]>;
}> => fetchSeroval(`/chains/${chainId}`);

export const getChainBlocking = async (chainId: string): Promise<{ items: UnknownJob[] }> =>
  fetchSeroval(`/chains/${chainId}/blocking`);

export const triggerJob = async (jobId: string): Promise<UnknownJob> => {
  const { job } = await fetchSeroval<{ job: UnknownJob }>(`/jobs/${jobId}/trigger`, {
    method: "POST",
  });
  return job;
};

export const deleteChain = async (chainId: string): Promise<void> => {
  await fetchSeroval(`/chains/${chainId}`, { method: "DELETE" });
};

export const getJobDetail = async (
  jobId: string,
): Promise<{
  job: UnknownJob;
  continuation: UnknownJob | null;
  blockers: UnknownJobChain[];
}> => fetchSeroval(`/jobs/${jobId}`);
