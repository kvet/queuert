import { type MutationOptions, type QueryKey, mutationOptions } from "@tanstack/solid-query";

import type { UnknownJob } from "../../shared/types.ts";
import { isNotFound, serverFns } from "../api.ts";
import {
  blockedJobsQuery,
  chainDetailQuery,
  chainJobsQuery,
  jobDetailQuery,
  queryClient,
} from "./queries.ts";

const startsWith = (queryKey: QueryKey, prefix: QueryKey): boolean =>
  prefix.every((part, index) => queryKey[index] === part);

const invalidateExcept = async (fresh: QueryKey[] = []): Promise<void> => {
  await queryClient.invalidateQueries({
    predicate: (query) => !fresh.some((prefix) => startsWith(query.queryKey, prefix)),
  });
};

const replaceCachedJob = (updated: UnknownJob): void => {
  const replace = (job: UnknownJob) => (job.id === updated.id ? updated : job);
  queryClient.setQueryData(
    jobDetailQuery(updated.id).queryKey,
    (detail) => detail && { ...detail, job: updated },
  );
  queryClient.setQueryData(
    chainDetailQuery(updated.chainId).queryKey,
    (detail) =>
      detail && {
        ...detail,
        currentJob: detail.currentJob?.id === updated.id ? updated : detail.currentJob,
        jobs: detail.jobs.map(replace),
      },
  );
  queryClient.setQueryData(
    chainJobsQuery(updated.chainId).queryKey,
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({ ...page, items: page.items.map(replace) })),
      },
  );
};

const forgetCachedChain = (chainId: string): void => {
  queryClient.removeQueries({ queryKey: chainDetailQuery(chainId).queryKey });
  queryClient.removeQueries({ queryKey: blockedJobsQuery({ chainId }).queryKey });
};

export const rescheduleJobMutation = (): MutationOptions<UnknownJob, Error, string> =>
  mutationOptions({
    mutationKey: ["jobs", "reschedule"],
    mutationFn: async (id: string) => serverFns.rescheduleJob({ data: { id } }),
    onSuccess: (job) => {
      replaceCachedJob(job);
      void invalidateExcept([
        jobDetailQuery(job.id).queryKey,
        chainDetailQuery(job.chainId).queryKey,
      ]);
    },
  });

export const deleteChainMutation = (): MutationOptions<"deleted" | "blocked", Error, string> =>
  mutationOptions({
    mutationKey: ["chains", "delete"],
    mutationFn: async (id: string) => {
      try {
        const { deleted } = await serverFns.deleteChain({ data: { id } });
        return (await deleted).outcome;
      } catch (error) {
        if (isNotFound(error)) return "deleted";
        throw error;
      }
    },
    onSuccess: (outcome, id) => {
      if (outcome === "blocked") {
        void queryClient.invalidateQueries({
          queryKey: blockedJobsQuery({ chainId: id }).queryKey,
        });
        return;
      }
      forgetCachedChain(id);
      void invalidateExcept();
    },
  });
