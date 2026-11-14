import { syncAsync, step, wait } from "@queuert/sync-async";

export const processChain = syncAsync(function* (client, workerRunner, chainId) {
  yield* wait(workerRunner.start());
  const chain = yield* step(client.getChain({ chainId }));
  yield* wait(sleep(10));
  return chain;
});
