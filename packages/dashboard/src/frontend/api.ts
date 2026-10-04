import { type Chain, type Job } from "queuert";
import { deserialize } from "seroval";

export type UnknownJob = Job<string, string, string, unknown, unknown, true>;
export type UnknownChain = Chain<string, string, unknown, unknown>;

const BASE = "./api";

export const PAGE_SIZE = 100;

/** Thrown for any non-success API response, including non-seroval bodies (404/503 text pages). */
export class ApiError extends Error {
  /** HTTP status of the response. */
  readonly status: number;

  constructor(message: string, options: { status: number; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ApiError";
    this.status = options.status;
  }
}

export const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const fetchSeroval = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  const isSeroval = response.headers.get("content-type")?.startsWith("application/x-seroval");
  if (!isSeroval) {
    throw new ApiError(
      response.ok
        ? "Unexpected response from the dashboard API"
        : text.trim() || response.statusText,
      { status: response.ok ? 500 : response.status },
    );
  }
  const body = deserialize<T & { error?: string }>(text);
  if (!response.ok) {
    throw new ApiError(body?.error ?? `${response.status} ${response.statusText}`, {
      status: response.status,
    });
  }
  return body;
};

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export const listChains = async (params: {
  typeName: string;
  status?: string;
  independent?: boolean;
  orderBy?: string;
  orderDirection?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PageResult<UnknownChain>> => {
  const searchParams = new URLSearchParams();
  searchParams.set("typeName", params.typeName);
  if (params.status) searchParams.set("status", params.status);
  if (params.independent !== undefined) searchParams.set("independent", String(params.independent));
  if (params.orderBy) searchParams.set("orderBy", params.orderBy);
  if (params.orderDirection) searchParams.set("orderDirection", params.orderDirection);
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.limit) searchParams.set("limit", String(params.limit));
  const queryString = searchParams.toString();
  return fetchSeroval<PageResult<UnknownChain>>(`/chains${queryString ? `?${queryString}` : ""}`, {
    signal: params.signal,
  });
};

export const listJobs = async (params: {
  typeName: string;
  status?: string;
  orderBy?: string;
  orderDirection?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PageResult<UnknownJob>> => {
  const searchParams = new URLSearchParams();
  searchParams.set("typeName", params.typeName);
  if (params.status) searchParams.set("status", params.status);
  if (params.orderBy) searchParams.set("orderBy", params.orderBy);
  if (params.orderDirection) searchParams.set("orderDirection", params.orderDirection);
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.limit) searchParams.set("limit", String(params.limit));
  const queryString = searchParams.toString();
  return fetchSeroval<PageResult<UnknownJob>>(`/jobs${queryString ? `?${queryString}` : ""}`, {
    signal: params.signal,
  });
};

export type ChainJobsPage = {
  jobs: UnknownJob[];
  jobBlockers: Record<string, UnknownChain[]>;
  nextCursor: string | null;
};

export const getChainDetail = async (
  chainId: string,
  params: { signal?: AbortSignal } = {},
): Promise<{ chain: UnknownChain; currentJob: UnknownJob | null } & ChainJobsPage> =>
  fetchSeroval(`/chains/${encodeURIComponent(chainId)}?limit=${PAGE_SIZE}`, {
    signal: params.signal,
  });

export const getChainJobs = async (
  chainId: string,
  params: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<ChainJobsPage> => {
  const searchParams = new URLSearchParams();
  if (params.cursor) searchParams.set("cursor", params.cursor);
  searchParams.set("limit", String(params.limit ?? PAGE_SIZE));
  return fetchSeroval(`/chains/${encodeURIComponent(chainId)}/jobs?${searchParams.toString()}`, {
    signal: params.signal,
  });
};

export const getChainBlocking = async (
  chainId: string,
  params: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PageResult<UnknownJob>> => {
  const searchParams = new URLSearchParams();
  if (params.cursor) searchParams.set("cursor", params.cursor);
  searchParams.set("limit", String(params.limit ?? PAGE_SIZE));
  return fetchSeroval(
    `/chains/${encodeURIComponent(chainId)}/blocking?${searchParams.toString()}`,
    {
      signal: params.signal,
    },
  );
};

export const rescheduleJob = async (
  jobId: string,
  params: { signal?: AbortSignal } = {},
): Promise<UnknownJob> => {
  const { job } = await fetchSeroval<{ job: UnknownJob }>(
    `/jobs/${encodeURIComponent(jobId)}/reschedule`,
    {
      method: "POST",
      signal: params.signal,
    },
  );
  return job;
};

export const deleteChain = async (
  chainId: string,
  params: { signal?: AbortSignal } = {},
): Promise<void> => {
  await fetchSeroval(`/chains/${encodeURIComponent(chainId)}`, {
    method: "DELETE",
    signal: params.signal,
  });
};

export const getJobDetail = async (
  jobId: string,
  params: { signal?: AbortSignal } = {},
): Promise<{ job: UnknownJob; continuation: UnknownJob | null; blockers: UnknownChain[] }> =>
  fetchSeroval(`/jobs/${encodeURIComponent(jobId)}`, { signal: params.signal });

export const getChainsByIds = async (
  ids: string[],
  params: { signal?: AbortSignal } = {},
): Promise<PageResult<UnknownChain>> =>
  fetchSeroval<PageResult<UnknownChain>>(
    `/chains/by-ids?ids=${encodeURIComponent(ids.join(","))}`,
    { signal: params.signal },
  );

export const getJobsByIds = async (
  ids: string[],
  params: { signal?: AbortSignal } = {},
): Promise<PageResult<UnknownJob>> =>
  fetchSeroval<PageResult<UnknownJob>>(`/jobs/by-ids?ids=${encodeURIComponent(ids.join(","))}`, {
    signal: params.signal,
  });

export const listChainTypeNames = async (
  params: { signal?: AbortSignal } = {},
): Promise<string[]> => fetchSeroval<string[]>("/chain-types", { signal: params.signal });

export const listJobTypeNames = async (params: { signal?: AbortSignal } = {}): Promise<string[]> =>
  fetchSeroval<string[]>("/job-types", { signal: params.signal });

type ChainTypeCounts = {
  typeName: string;
  running: { count: number; hasMore: boolean };
  completed: { count: number; hasMore: boolean };
};

type JobTypeCounts = {
  typeName: string;
  blocked: { count: number; hasMore: boolean };
  pending: { count: number; hasMore: boolean };
  running: { count: number; hasMore: boolean };
  completed: { count: number; hasMore: boolean };
};

export const countByChainTypeNames = async (
  typeNames: string[],
  params: { signal?: AbortSignal } = {},
): Promise<ChainTypeCounts[]> =>
  fetchSeroval<ChainTypeCounts[]>(
    `/chain-types/counts?typeNames=${encodeURIComponent(typeNames.join(","))}`,
    { signal: params.signal },
  );

export const countByJobTypeNames = async (
  typeNames: string[],
  params: { signal?: AbortSignal } = {},
): Promise<JobTypeCounts[]> =>
  fetchSeroval<JobTypeCounts[]>(
    `/job-types/counts?typeNames=${encodeURIComponent(typeNames.join(","))}`,
    { signal: params.signal },
  );
