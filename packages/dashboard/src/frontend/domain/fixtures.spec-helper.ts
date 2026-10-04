import { type UnknownChain, type UnknownJob } from "../api.js";

const base = {
  chainId: "chain-1",
  typeName: "work",
  chainTypeName: "flow",
  chainIndex: 0,
  input: null,
  createdAt: new Date(0),
  scheduledAt: new Date(0),
  attempt: 0,
  lastAttemptAt: null,
  lastAttemptError: null,
};

export const blockedJob = (overrides: Partial<UnknownJob> = {}): UnknownJob =>
  ({ id: "job", ...base, status: "blocked", ...overrides }) as UnknownJob;

export const pendingJob = (overrides: Partial<UnknownJob> = {}): UnknownJob =>
  ({ id: "job", ...base, status: "pending", ...overrides }) as UnknownJob;

export const runningJob = (
  overrides: Partial<Extract<UnknownJob, { status: "running" }>> = {},
): UnknownJob =>
  ({
    id: "job",
    ...base,
    status: "running",
    attempt: 1,
    attemptAt: new Date(1000),
    attemptBy: "worker-1",
    attemptUntil: new Date(11_000),
    ...overrides,
  }) as UnknownJob;

export const continuedJob = (id: string, overrides: Partial<UnknownJob> = {}): UnknownJob =>
  ({
    id,
    ...base,
    status: "completed",
    attempt: 1,
    completedAt: new Date(5000),
    completedBy: "worker-1",
    continuedToId: `${id}-next`,
    ...overrides,
  }) as UnknownJob;

export const tailJob = (id: string, overrides: Partial<UnknownJob> = {}): UnknownJob =>
  ({
    id,
    ...base,
    status: "completed",
    attempt: 1,
    completedAt: new Date(5000),
    completedBy: "worker-1",
    continuedToId: null,
    output: { ok: true },
    ...overrides,
  }) as UnknownJob;

export const runningChain = (id: string): UnknownChain =>
  ({ id, typeName: "dep", input: null, createdAt: new Date(0), status: "running" }) as UnknownChain;
