import { expect, it } from "vitest";

import { shiftStateDump } from "../state-adapter/state-dump.ts";
import { generateStateDump } from "./generate-state-dump.ts";
import { observabilityCoverageGroups, operationalCoverageGroups } from "./index-coverage-cases.ts";
import { readStateRows, toStateRows } from "./read-state-rows.ts";
import { createSeedStateAdapter } from "./seed-state-adapter.ts";

it("writes every timestamp from the clock it is given", () => {
  const clock = { nowMs: Date.UTC(2026, 0, 1) };
  const { stateAdapter } = createSeedStateAdapter({ now: () => clock.nowMs });
  const startedAt = new Date(clock.nowMs);
  const worker = stateAdapter.startWorker({
    workerId: "w1",
    typeNames: ["a"],
    concurrency: 1,
    leaseMs: 1000,
  });
  expect(worker).toMatchObject({ startedAt, leaseUntil: new Date(clock.nowMs + 1000) });

  const [chain] = stateAdapter.withTransaction((txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [{ id: "j1", typeName: "a", input: null, schedule: { afterMs: 500 } }],
    }),
  );
  expect(chain.head).toMatchObject({
    createdAt: startedAt,
    scheduledAt: new Date(clock.nowMs + 500),
  });
  expect(stateAdapter.getStartAttemptDelayMs({ typeNames: ["a"] })).toBe(500);

  clock.nowMs += 500;
  const [job] = stateAdapter.withTransaction((txCtx) =>
    stateAdapter.startJobAttempts({
      txCtx,
      batchLimits: { a: 1 },
      workerId: worker.id,
      workerToken: worker.token,
      limit: 1,
    }),
  );
  expect(job.attemptAt).toEqual(new Date(clock.nowMs));

  clock.nowMs += 1000;
  expect(stateAdapter.getWorkers({ workerIds: ["w1"] })[0]?.expired).toBe(true);
});

it("generates the same dataset on every run apart from attempt and worker tokens", () => {
  const withoutTokens = ({ dump }: ReturnType<typeof generateStateDump>) => ({
    ...dump,
    jobs: dump.jobs.map(({ attemptToken: _attemptToken, ...job }) => job),
    workers: dump.workers.map(({ token: _token, ...worker }) => worker),
  });
  expect(withoutTokens(generateStateDump())).toEqual(withoutTokens(generateStateDump()));
});

it("loads a dump shifted by the offset into a state that answers like the original", () => {
  const { dump } = generateStateDump();
  const { stateAdapter, loadState } = createSeedStateAdapter();
  loadState(dump, { offsetMs: 60_000 });

  expect(readStateRows(stateAdapter)).toEqual(toStateRows(shiftStateDump(dump, 60_000)));
  expect(stateAdapter.countJobsByTypeName({ typeNames: ["seed:pending:order"] })).toEqual([
    {
      blocked: { count: 0, hasMore: false },
      pending: { count: 1500, hasMore: false },
      running: { count: 0, hasMore: false },
      completed: { count: 0, hasMore: false },
    },
  ]);

  const deduplicated = dump.chains.find(
    (chain) => chain.deduplicationKey !== null && chain.status === "running",
  )!;
  const [chain] = stateAdapter.withTransaction((txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [
        {
          id: "duplicate",
          typeName: deduplicated.typeName,
          input: null,
          deduplication: { key: deduplicated.deduplicationKey!, scope: "running" },
        },
      ],
    }),
  );
  expect(chain).toMatchObject({ id: deduplicated.id, deduplicated: true });
});

it("refuses to load into a state that already holds rows", () => {
  const { dump } = generateStateDump();
  const { loadState } = createSeedStateAdapter();
  loadState(dump, { offsetMs: 0 });
  expect(() => {
    loadState(dump, { offsetMs: 0 });
  }).toThrow("loadState needs an empty in-process state and no open transaction");
});

it("runs every index coverage case against the generated dataset", async () => {
  const { dump, sentinels } = generateStateDump();
  const { stateAdapter, loadState } = createSeedStateAdapter();
  loadState(dump, { offsetMs: Date.now() - dump.capturedAt.getTime() });

  for (const testCase of [...operationalCoverageGroups, ...observabilityCoverageGroups].flatMap(
    (group) => group.cases,
  )) {
    const act = await testCase.run(stateAdapter, sentinels);
    await act(stateAdapter, sentinels);
  }
});
