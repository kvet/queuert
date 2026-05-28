import { type Job as CoreJob, type Chain as CoreChain } from "queuert";
// @ts-expect-error tsgo doesn't resolve export * re-exports from seroval
import { deserialize } from "seroval";

export type UnknownJob = CoreJob<string, string, string, unknown, unknown, true>;
export type UnknownChain = CoreChain<string, string, unknown, unknown>;

const BASE = "./api";

const fetchSeroval = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, init);
  const body = deserialize<T & { error?: string }>(await response.text());
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  return body;
};

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export const listChains = async (
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
): Promise<PageResult<UnknownChain>> => {
  const searchParams = new URLSearchParams();
  if (params.typeName) searchParams.set("typeName", params.typeName);
  if (params.status) searchParams.set("status", params.status);
  if (params.root === false) searchParams.set("root", "false");
  if (params.id) searchParams.set("id", params.id);
  if (params.jobId) searchParams.set("jobId", params.jobId);
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.limit) searchParams.set("limit", String(params.limit));
  const queryString = searchParams.toString();
  return fetchSeroval<PageResult<UnknownChain>>(`/chains${queryString ? `?${queryString}` : ""}`, {
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
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set("status", params.status);
  if (params.typeName) searchParams.set("typeName", params.typeName);
  if (params.chainId) searchParams.set("chainId", params.chainId);
  if (params.id) searchParams.set("id", params.id);
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.limit) searchParams.set("limit", String(params.limit));
  const queryString = searchParams.toString();
  return fetchSeroval<PageResult<UnknownJob>>(`/jobs${queryString ? `?${queryString}` : ""}`, {
    signal: params.signal,
  });
};

export const getChainDetail = async (
  chainId: string,
): Promise<{
  chain: UnknownChain;
  jobs: UnknownJob[];
  jobBlockers: Record<string, UnknownChain[]>;
}> => fetchSeroval(`/chains/${chainId}`);

export const getChainBlocking = async (chainId: string): Promise<{ items: UnknownJob[] }> =>
  fetchSeroval(`/chains/${chainId}/blocking`);

export const triggerJob = async (jobId: string): Promise<UnknownJob> => {
  const { job } = await fetchSeroval<{ job: UnknownJob }>(`/jobs/${jobId}/trigger`, {
    method: "POST",
  });
  return job;
};

export const deleteChain = async (
  chainId: string,
  options?: { cascade?: boolean },
): Promise<void> => {
  const queryString = options?.cascade ? "?cascade=true" : "";
  await fetchSeroval(`/chains/${chainId}${queryString}`, { method: "DELETE" });
};

export const getJobDetail = async (
  jobId: string,
): Promise<{
  job: UnknownJob;
  continuation: UnknownJob | null;
  blockers: UnknownChain[];
}> => fetchSeroval(`/jobs/${jobId}`);
