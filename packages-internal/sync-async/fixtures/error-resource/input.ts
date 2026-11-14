import { syncAsync, resource, step } from "@queuert/sync-async";

export const countJobs = syncAsync(function* ({ createStateAdapter }) {
  const stateAdapter = yield* resource(createStateAdapter());
  const jobs = yield* step(stateAdapter.listJobs({}));
  return jobs.length;
});
