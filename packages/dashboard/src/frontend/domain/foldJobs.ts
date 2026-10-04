import { type UnknownChain, type UnknownJob } from "../api.js";

export type JobEntry =
  | { kind: "job"; job: UnknownJob }
  | { kind: "fold"; jobs: UnknownJob[]; typeName: string };

const MIN_FOLD = 3;

const isFoldable = (job: UnknownJob, jobBlockers: Record<string, UnknownChain[]>): boolean =>
  job.status === "completed" &&
  job.continuedToId !== null &&
  (jobBlockers[job.id]?.length ?? 0) === 0;

/**
 * Collapses runs of at least {@link MIN_FOLD} consecutive completed, continued jobs of the same
 * type and without blockers into a single fold. Any other job (blocked, pending, running, the tail,
 * or one that waited on blockers) is shown on its own and breaks a run. Pure, so callers re-run it
 * on the whole loaded array after each page append.
 */
export const foldJobs = (
  jobs: UnknownJob[],
  jobBlockers: Record<string, UnknownChain[]>,
): JobEntry[] => {
  const entries: JobEntry[] = [];
  let run: UnknownJob[] = [];

  const flush = () => {
    if (run.length >= MIN_FOLD) {
      entries.push({ kind: "fold", jobs: run, typeName: run[0].typeName });
    } else {
      for (const job of run) entries.push({ kind: "job", job });
    }
    run = [];
  };

  for (const job of jobs) {
    if (!isFoldable(job, jobBlockers)) {
      flush();
      entries.push({ kind: "job", job });
      continue;
    }
    if (run.length > 0 && run[0].typeName !== job.typeName) flush();
    run.push(job);
  }
  flush();

  return entries;
};
