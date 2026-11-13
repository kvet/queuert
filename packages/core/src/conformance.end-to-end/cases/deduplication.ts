import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { inMode } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

export const deduplicationGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "deduplication",
  cases: [
    {
      name: "deduplicates chains with same deduplication key",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [chain1, chain2, chain3] = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            return [
              yield* step(
                client.createChain({
                  ...txCtx,
                  typeName: "test",
                  input: { value: 1 },
                  deduplication: { key: "same-key", scope: "running" },
                }),
              ),
              yield* step(
                client.createChain({
                  ...txCtx,
                  typeName: "test",
                  input: { value: 2 },
                  deduplication: { key: "same-key", scope: "running" },
                }),
              ),
              yield* step(
                client.createChain({
                  ...txCtx,
                  typeName: "test",
                  input: { value: 3 },
                  deduplication: { key: "different-key", scope: "running" },
                }),
              ),
            ];
          }),
        );

        assert.equal(chain1.deduplicated, false);
        assert.equal(chain2.deduplicated, true);
        assert.equal(chain2.id, chain1.id);
        assert.equal(chain3.deduplicated, false);
        assert.notEqual(chain3.id, chain1.id);

        const completed1 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain1,
              handler: ({ job, completeJob }) => {
                return completeJob(job, ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                );
              },
            }),
          ),
        );

        const completed3 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain3,
              handler: ({ job, completeJob }) => {
                return completeJob(job, ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                );
              },
            }),
          ),
        );

        assert.equal(completed1.status, "completed");
        assert.equal(completed3.status, "completed");
        assert.deepEqual(completed1.output, { result: 1 });
        assert.deepEqual(completed3.output, { result: 3 });

        const fetched2 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) => client.getChain({ ...txCtx, ...chain2 })),
        );
        assert.deepEqual("output" in fetched2! && fetched2.output, { result: 1 });
      }),
    },
    {
      name: "scope 'running' deduplicates against multi-step chains that have continued",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          step1: {
            entry: true;
            input: { value: number };
            continueWith: { typeName: "step2" };
          };
          step2: {
            input: { continued: boolean };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain1 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 1 },
              deduplication: { key: "multi-step-key", scope: "running" },
            }),
          ),
        );

        assert.equal(chain1.deduplicated, false);

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain1,
              handler: ({ job, completeJob }) => {
                if (job.typeName === "step1") {
                  return completeJob(job, ({ complete }) =>
                    complete({ continueWith: { typeName: "step2", input: { continued: true } } }),
                  );
                }
              },
            }),
          ),
        );

        const chain2 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 2 },
              deduplication: { key: "multi-step-key", scope: "running" },
            }),
          ),
        );

        assert.equal(chain2.deduplicated, true);
        assert.equal(chain2.id, chain1.id);

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain1,
              handler: ({ job, completeJob }) => {
                if (job.typeName === "step2") {
                  return completeJob(job, ({ complete }) => complete({ output: { result: 42 } }));
                }
              },
            }),
          ),
        );

        const chain3 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 3 },
              deduplication: { key: "multi-step-key", scope: "running" },
            }),
          ),
        );

        assert.equal(chain3.deduplicated, false);
        assert.notEqual(chain3.id, chain1.id);
      }),
    },
    {
      name: "scope 'any' returns the output of a completed multi-step chain it matches",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          step1: {
            entry: true;
            input: { value: number };
            continueWith: { typeName: "step2" };
          };
          step2: {
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 1 },
              deduplication: { key: "any-multi-step-key", scope: "any" },
            }),
          ),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain,
              handler: ({ job, completeJob }) =>
                inMode(stateAdapter, function* () {
                  if (job.typeName === "step1") {
                    job = yield* step(
                      completeJob(job, ({ complete }) =>
                        complete({ continueWith: { typeName: "step2", input: { value: 42 } } }),
                      ),
                    );
                  }
                  if (job.typeName === "step2") {
                    return yield* step(
                      completeJob(job, ({ complete }) =>
                        complete({ output: { result: job.input.value } }),
                      ),
                    );
                  }
                }),
            }),
          ),
        );

        const matched = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 2 },
              deduplication: { key: "any-multi-step-key", scope: "any" },
            }),
          ),
        );

        assert.equal(matched.deduplicated, true);
        assert.equal(matched.id, chain.id);
        assert.equal(matched.status, "completed");
        assert.deepEqual("output" in matched && matched.output, { result: 42 });
      }),
    },
    {
      name: "scope 'running' picks running chain when completed chain exists with same key",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain1 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
              deduplication: { key: "coexist-key", scope: "running" },
            }),
          ),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain1,
              handler: ({ job, completeJob }) => {
                return completeJob(job, ({ complete }) => complete({ output: { result: 1 } }));
              },
            }),
          ),
        );

        const chain2 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 2 },
              deduplication: { key: "coexist-key", scope: "running" },
            }),
          ),
        );

        assert.equal(chain2.deduplicated, false);
        assert.notEqual(chain2.id, chain1.id);

        const chain3 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 3 },
              deduplication: { key: "coexist-key", scope: "running" },
            }),
          ),
        );

        assert.equal(chain3.deduplicated, true);
        assert.equal(chain3.id, chain2.id);
      }),
    },
    {
      name: "deduplication scopes: 'any' vs 'running'",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const allChain1 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
              deduplication: { key: "all-key", scope: "any" },
            }),
          ),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...allChain1,
              handler: ({ job, completeJob }) => {
                return completeJob(job, ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                );
              },
            }),
          ),
        );

        const allChain2 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 2 },
              deduplication: { key: "all-key", scope: "any" },
            }),
          ),
        );

        assert.equal(allChain2.deduplicated, true);
        assert.equal(allChain2.id, allChain1.id);

        const completedChain1 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 3 },
              deduplication: { key: "completed-key", scope: "running" },
            }),
          ),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...completedChain1,
              handler: ({ job, completeJob }) => {
                return completeJob(job, ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                );
              },
            }),
          ),
        );

        const completedChain2 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 4 },
              deduplication: { key: "completed-key", scope: "running" },
            }),
          ),
        );

        assert.equal(completedChain2.deduplicated, false);
        assert.notEqual(completedChain2.id, completedChain1.id);

        const completed2 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...completedChain2,
              handler: ({ job, completeJob }) => {
                return completeJob(job, ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                );
              },
            }),
          ),
        );
        assert.equal(completed2.status, "completed");
        assert.deepEqual(completed2.output, { result: 4 });
      }),
    },
    {
      name: "does not deduplicate across different chain types with the same key",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          typeA: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          typeB: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [chainA, chainB] = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            return [
              yield* step(
                client.createChain({
                  ...txCtx,
                  typeName: "typeA",
                  input: { value: 1 },
                  deduplication: { key: "shared-key", scope: "running" },
                }),
              ),
              yield* step(
                client.createChain({
                  ...txCtx,
                  typeName: "typeB",
                  input: { value: 2 },
                  deduplication: { key: "shared-key", scope: "running" },
                }),
              ),
            ];
          }),
        );

        assert.equal(chainA.deduplicated, false);
        assert.equal(chainB.deduplicated, false);
        assert.notEqual(chainB.id, chainA.id);
      }),
    },
    {
      name: "deduplicates within a batch",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [chain1, chain2, chain3] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                {
                  typeName: "test",
                  input: { value: 1 },
                  deduplication: { key: "same-key", scope: "running" },
                },
                {
                  typeName: "test",
                  input: { value: 2 },
                  deduplication: { key: "same-key", scope: "running" },
                },
                {
                  typeName: "test",
                  input: { value: 3 },
                  deduplication: { key: "different-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(chain1.deduplicated, false);
        assert.equal(chain2.deduplicated, true);
        assert.equal(chain2.id, chain1.id);
        assert.equal(chain3.deduplicated, false);
        assert.notEqual(chain3.id, chain1.id);
      }),
    },
    {
      name: "deduplicates against pre-existing chains",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const existing = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 100 },
              deduplication: { key: "existing-key", scope: "running" },
            }),
          ),
        );

        const [chain1, chain2] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                {
                  typeName: "test",
                  input: { value: 1 },
                  deduplication: { key: "existing-key", scope: "running" },
                },
                {
                  typeName: "test",
                  input: { value: 2 },
                  deduplication: { key: "fresh-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(chain1.deduplicated, true);
        assert.equal(chain1.id, existing.id);
        assert.equal(chain2.deduplicated, false);
        assert.notEqual(chain2.id, existing.id);
      }),
    },
    {
      name: "deduplication scopes: 'any' vs 'running' in a createChains batch",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const anyChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
              deduplication: { key: "any-key", scope: "any" },
            }),
          ),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...anyChain,
              handler: ({ job, completeJob }) => {
                return completeJob(job, ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                );
              },
            }),
          ),
        );

        const incompleteChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 2 },
              deduplication: { key: "incomplete-key", scope: "running" },
            }),
          ),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...incompleteChain,
              handler: ({ job, completeJob }) => {
                return completeJob(job, ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                );
              },
            }),
          ),
        );

        const [anyResult, incompleteResult] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                {
                  typeName: "test",
                  input: { value: 3 },
                  deduplication: { key: "any-key", scope: "any" },
                },
                {
                  typeName: "test",
                  input: { value: 4 },
                  deduplication: { key: "incomplete-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(anyResult.deduplicated, true);
        assert.equal(anyResult.id, anyChain.id);
        assert.equal(incompleteResult.deduplicated, false);
        assert.notEqual(incompleteResult.id, incompleteChain.id);
      }),
    },
    {
      name: "does not deduplicate across different chain types with the same key in a createChains batch",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          typeA: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          typeB: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [chainA, chainB] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                {
                  typeName: "typeA",
                  input: { value: 1 },
                  deduplication: { key: "shared-key", scope: "running" },
                },
                {
                  typeName: "typeB",
                  input: { value: 2 },
                  deduplication: { key: "shared-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(chainA.deduplicated, false);
        assert.equal(chainB.deduplicated, false);
        assert.notEqual(chainB.id, chainA.id);
      }),
    },
    {
      name: "rejects a missing or unknown deduplication scope",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: null;
            output: null;
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        for (const deduplication of [{ key: "k" }, { key: "k", scope: "incomplete" }]) {
          yield* step(
            assertRejects(
              () =>
                withCaseTransaction(stateAdapter, (txCtx) =>
                  client.createChain({
                    ...txCtx,
                    typeName: "test",
                    input: null,
                    deduplication: deduplication as any,
                  }),
                ),
              /Invalid deduplication scope/,
            ),
          );
        }
      }),
    },
  ],
};
