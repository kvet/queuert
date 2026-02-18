const BASE = "./api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export type SerializedJob = {
  id: string;
  typeName: string;
  chainId: string;
  chainTypeName: string;
  input: unknown;
  output: unknown;
  rootChainId: string;
  originId: string | null;
  status: "blocked" | "pending" | "running" | "completed";
  createdAt: string;
  scheduledAt: string;
  completedAt: string | null;
  completedBy: string | null;
  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: string | null;
  leasedBy: string | null;
  leasedUntil: string | null;
  deduplicationKey: string | null;
  traceContext: unknown;
};

export type ChainItem = [SerializedJob, SerializedJob | null];

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
): Promise<PageResult<ChainItem>> => {
  const qs = new URLSearchParams();
  if (params.typeName) qs.set("typeName", params.typeName);
  if (params.rootOnly === false) qs.set("rootOnly", "false");
  if (params.id) qs.set("id", params.id);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return fetchJson(`/chains${q ? `?${q}` : ""}`);
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
): Promise<PageResult<SerializedJob>> => {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.typeName) qs.set("typeName", params.typeName);
  if (params.chainId) qs.set("chainId", params.chainId);
  if (params.id) qs.set("id", params.id);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return fetchJson(`/jobs${q ? `?${q}` : ""}`);
};

export const getChainDetail = async (
  chainId: string,
): Promise<{
  rootJob: SerializedJob;
  lastJob: SerializedJob | null;
  jobs: SerializedJob[];
  jobBlockers: Record<string, [SerializedJob, SerializedJob | null][]>;
}> => fetchJson(`/chains/${chainId}`);

export const getChainBlocking = async (chainId: string): Promise<{ items: SerializedJob[] }> =>
  fetchJson(`/chains/${chainId}/blocking`);

export const getJobDetail = async (
  jobId: string,
): Promise<{
  job: SerializedJob;
  continuation: SerializedJob | null;
  blockers: [SerializedJob, SerializedJob | null][];
}> => fetchJson(`/jobs/${jobId}`);
