import { type MaybePromise, type Mode, step, syncAsync } from "@queuert/sync-async";

import { runInModeOf } from "../conformance/adapters.ts";
import type { Page, PageParams } from "../entities/pagination.ts";
import type {
  StateAdapter,
  StateChain,
  StateChainInfo,
  StateChainStatus,
  StateCount,
  StateJob,
  StateJobInfo,
  StateJobStatus,
  StateWorkerCounts,
  StateWorkerInfo,
} from "../state-adapter/state-adapter.ts";
import type { StateDump, StateDumpWorker } from "../state-adapter/state-dump.ts";

export type StateRows = {
  chains: StateChainInfo[];
  jobs: StateJobInfo[];
  blockers: { jobId: string; blockedByChainId: string; index: number }[];
  workers: StateDumpWorker[];
};

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortRows = (rows: StateRows): StateRows => ({
  chains: rows.chains.toSorted((a, b) => compareStrings(a.id, b.id)),
  jobs: rows.jobs.toSorted((a, b) => compareStrings(a.id, b.id)),
  blockers: rows.blockers.toSorted((a, b) => compareStrings(a.jobId, b.jobId) || a.index - b.index),
  workers: rows.workers.toSorted((a, b) => compareStrings(a.id, b.id)),
});

export const toStateRows = (dump: StateDump): StateRows =>
  sortRows({
    chains: dump.chains,
    jobs: dump.jobs,
    blockers: dump.blockers.map(({ jobId, blockedByChainId, index }) => ({
      jobId,
      blockedByChainId,
      index,
    })),
    workers: dump.workers,
  });

const readAllPages = syncAsync(function* (
  readPage: (page: PageParams) => MaybePromise<Page<unknown>>,
) {
  const items: unknown[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<unknown> = yield* step(
      readPage({ limit: 1000, ...(cursor === null ? {} : { cursor }) }),
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
});

export const readStateRows = (
  stateAdapter: StateAdapter<any, any, any, Mode>,
): MaybePromise<StateRows> =>
  runInModeOf(
    stateAdapter,
    syncAsync(function* () {
      const jobs: StateJobInfo[] = [];
      for (const typeName of yield* step(stateAdapter.getJobTypeNames({}))) {
        const typeJobs = (yield* readAllPages.steps((page) =>
          stateAdapter.listJobs({ typeName, orderBy: "createdAt", orderDirection: "asc", page }),
        )) as StateJob[];
        jobs.push(...typeJobs.map(({ chain: _chain, ...job }) => job));
      }

      const chains: StateChainInfo[] = [];
      for (const typeName of yield* step(stateAdapter.getChainTypeNames({}))) {
        const typeChains = (yield* readAllPages.steps((page) =>
          stateAdapter.listChains({ typeName, orderBy: "createdAt", orderDirection: "asc", page }),
        )) as StateChain[];
        chains.push(...typeChains.map(({ head: _head, tail: _tail, ...chain }) => chain));
      }

      const blockers: StateRows["blockers"] = [];
      const jobsBlockerChains = yield* step(
        stateAdapter.getJobsBlockers({ jobIds: jobs.map((job) => job.id) }),
      );
      for (const [jobIndex, job] of jobs.entries()) {
        blockers.push(
          ...jobsBlockerChains[jobIndex].map((chain, index) => ({
            jobId: job.id,
            blockedByChainId: chain.id,
            index,
          })),
        );
      }

      const workers = (yield* readAllPages.steps((page) =>
        stateAdapter.listWorkers({ orderDirection: "asc", page }),
      )) as StateWorkerInfo[];

      return sortRows({
        chains,
        jobs,
        blockers,
        workers: workers.map(({ expired: _expired, ...worker }) => worker),
      });
    }),
  );

export type StateCounts = {
  jobs: Record<string, Record<StateJobStatus, StateCount>>;
  chains: Record<string, Record<StateChainStatus, StateCount>>;
  workers: StateWorkerCounts;
};

export const readStateCounts = (
  stateAdapter: StateAdapter<any, any, any, Mode>,
): MaybePromise<StateCounts> =>
  runInModeOf(
    stateAdapter,
    syncAsync(function* () {
      const jobTypeNames = yield* step(stateAdapter.getJobTypeNames({}));
      const jobCounts = yield* step(stateAdapter.countJobsByTypeName({ typeNames: jobTypeNames }));
      const chainTypeNames = yield* step(stateAdapter.getChainTypeNames({}));
      const chainCounts = yield* step(
        stateAdapter.countChainsByTypeName({ typeNames: chainTypeNames }),
      );
      return {
        jobs: Object.fromEntries(
          jobTypeNames.map((typeName, index) => [typeName, jobCounts[index]]),
        ),
        chains: Object.fromEntries(
          chainTypeNames.map((typeName, index) => [typeName, chainCounts[index]]),
        ),
        workers: yield* step(stateAdapter.countWorkers({})),
      };
    }),
  );
