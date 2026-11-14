import { expect, test } from "vitest";

import { defineJobTypes } from "../job-types/define-job-types.ts";
import { noopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import { createClient } from "./client.ts";

const jobTypes = defineJobTypes<{
  "send-welcome-email": { entry: true; input: null; output: { sent: true } };
}>();

test("a sync client rejects completeChain handlers and completeJob callbacks that return promises", () => {
  using stateAdapter = createInProcessStateAdapter();
  const client = createClient({ stateAdapter, jobTypes, notifyAdapter: noopNotifyAdapter });
  const chain = stateAdapter.withTransaction((txCtx) =>
    client.createChain({ ...txCtx, typeName: "send-welcome-email", input: null }),
  );

  expect(() =>
    stateAdapter.withTransaction((txCtx) =>
      client.completeChain({
        ...txCtx,
        id: chain.id,
        typeName: "send-welcome-email",
        handler: async () => {},
      }),
    ),
  ).toThrow("A synchronous step got a promise: the value must be synchronous");

  expect(() =>
    stateAdapter.withTransaction((txCtx) =>
      client.completeChain({
        ...txCtx,
        id: chain.id,
        typeName: "send-welcome-email",
        handler: ({ job, completeJob }) => {
          // @ts-expect-error -- a sync client's completeJob callback must not return a promise
          completeJob(job, async ({ complete }) => complete({ output: { sent: true } }));
        },
      }),
    ),
  ).toThrow("A synchronous step got a promise: the value must be synchronous");

  expect(
    stateAdapter.withTransaction((txCtx) =>
      client.getChain({ ...txCtx, id: chain.id, typeName: "send-welcome-email" }),
    )?.status,
  ).toBe(chain.status);
});
