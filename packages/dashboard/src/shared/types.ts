import type { Chain, Job, Worker } from "queuert";

export type UnknownJob = Job<string, string, string, string, unknown, unknown, true>;
export type UnknownChain = Chain<string, string, unknown, unknown>;
export type UnknownWorker = Worker<string>;
export type WorkerWithRunningJobs = UnknownWorker & { runningJobCount: number };
