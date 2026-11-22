import { Box, MoreIcon, StatusDot, StatusPill } from "@queuert/ui/components";
import { shortId } from "@queuert/ui/lib";
import { useNavigate, useParams } from "@solidjs/router";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal, onSettled } from "solid-js";

import type { UnknownChain, UnknownJob } from "../../shared/types.ts";
import { errorMessage } from "../api.ts";
import { appHref } from "../base.ts";
import { formatCount } from "../domain/counts.ts";
import { elapsedMs, formatDuration } from "../domain/duration.ts";
import { type JobEntry, foldJobs } from "../domain/foldJobs.ts";
import { loadedAnnouncement, loadedItems, shouldLoadNextPage } from "../domain/pages.ts";
import { BlockedJobRow } from "../rows/BlockedJobRow.tsx";
import { FoldItem, JobItem } from "../rows/JobItem.tsx";
import { PageHeader } from "../shell/PageHeader.tsx";
import { deleteChainMutation } from "../state/mutations.ts";
import { blockedJobsQuery, chainDetailQuery, chainJobsQuery } from "../state/queries.ts";
import { IdChip } from "../ui/IdChip.tsx";
import { JsonViewer } from "../ui/JsonViewer.tsx";
import {
  Dialog,
  ErrorState,
  LiveRegion,
  NotFoundState,
  QueryBoundary,
  SkeletonCard,
  buttonClass,
} from "../ui/kit.tsx";
import { Time } from "../ui/Time.tsx";
import { LoadMoreFooter, VirtualList } from "./listParts.tsx";

const AUTO_LOAD_MARGIN = "300px";

const chainListHref = (typeName: string): string =>
  `/chains?typeName=${encodeURIComponent(typeName)}`;

const entryKey = (entry: JobEntry): string =>
  entry.kind === "job" ? `job:${entry.job.id}` : `fold:${entry.jobs[0].id}`;

const sameEntry = (a: JobEntry, b: JobEntry): boolean =>
  a.kind === "job"
    ? b.kind === "job" && a.job === b.job
    : b.kind === "fold" &&
      a.jobs.length === b.jobs.length &&
      a.jobs.every((job, index) => job === b.jobs[index]);

const ActionsMenu = (props: { onDelete: () => void }) => {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;

  onSettled(() => {
    const onPointer = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  });

  return (
    <div
      class="relative"
      ref={(element) => {
        root = element;
      }}
    >
      <button
        type="button"
        class={[buttonClass.secondary, "px-2"]}
        aria-label="More actions"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </button>
      <Show when={open()}>
        <div class="absolute right-0 z-20 mt-1 w-44 rounded-xs border border-border bg-surface p-1 shadow-lg">
          <button
            type="button"
            class="w-full rounded-xs px-3 py-1.5 text-left text-sm text-error-fg hover:bg-error-bg"
            onClick={() => {
              setOpen(false);
              props.onDelete();
            }}
          >
            Delete chain…
          </button>
        </div>
      </Show>
    </div>
  );
};

const CurrentJobChip = (props: { job: UnknownJob }) => (
  <a
    href={appHref(`/jobs/${props.job.id}`)}
    class="inline-flex shrink-0 items-center gap-1.5 rounded-xs border border-border px-2 py-0.5 text-xs font-normal tracking-normal text-fg-muted hover:border-border-strong hover:text-fg"
    title={`${props.job.typeName} · ${props.job.id}`}
  >
    current job
    <span class="font-medium text-fg tabular-nums">#{props.job.chainIndex + 1}</span>
    <StatusDot status={props.job.status} />
    {props.job.status}
  </a>
);

const DeleteChainDialog = (props: {
  open: boolean;
  onClose: () => void;
  chain: UnknownChain;
  jobsLabel: string;
  blockedJobs: UnknownJob[];
  blockedJobsLabel: string;
}) => {
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = createSignal("");
  const remove = useMutation(() => deleteChainMutation());
  const deleting = () => remove.isPending;
  const error = () =>
    remove.data === "blocked"
      ? "Cannot delete: other jobs depend on this chain as a blocker"
      : remove.error
        ? errorMessage(remove.error)
        : null;

  const blocked = () => props.blockedJobs.length > 0;
  const matches = () => confirmText() === props.chain.id;

  createEffect(
    () => props.open,
    (open) => {
      if (open) {
        setConfirmText("");
        remove.reset();
      }
    },
  );

  const submit = async () => {
    if (!matches() || blocked() || deleting()) return;
    const { id, typeName } = props.chain;
    const outcome = await remove.mutate(id).catch(() => undefined);
    if (outcome === "deleted") {
      props.onClose();
      navigate(appHref(chainListHref(typeName)));
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} title="Delete chain?" busy={deleting()}>
      <p class="text-sm">
        This removes the chain <strong class="font-semibold">{props.chain.typeName}</strong> and all{" "}
        {props.jobsLabel} of its jobs. It can't be undone.
      </p>
      <Show
        when={props.blockedJobs[0]}
        fallback={
          <form
            class="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label class="text-sm text-fg-muted" for="delete-confirm">
              Type the chain ID to confirm:
            </label>
            <code class="mt-1 mb-2 block rounded-xs bg-surface-2 px-2 py-1 font-mono text-xs break-all">
              {props.chain.id}
            </code>
            <input
              id="delete-confirm"
              type="text"
              autocomplete="off"
              class="h-9 w-full rounded-xs border border-border-strong bg-surface px-3 font-mono text-sm"
              placeholder="Chain ID"
              value={confirmText()}
              onInput={(event) => setConfirmText(event.currentTarget.value)}
            />
          </form>
        }
      >
        {(blockedJob) => (
          <div
            class="mt-4 rounded-xs border border-error-border bg-error-bg px-3 py-2 text-sm text-error-fg"
            role="alert"
          >
            <strong class="font-semibold">Can't delete yet.</strong> At least{" "}
            {props.blockedJobsLabel} job(s) still reference this chain as a blocker, even completed
            ones:{" "}
            <a
              href={appHref(`/jobs/${blockedJob().id}`)}
              class="underline"
              onClick={() => {
                props.onClose();
              }}
            >
              job {blockedJob().typeName} {shortId(blockedJob().id)}
            </a>
            . Delete that job's chain first.
          </div>
        )}
      </Show>
      <Show when={error()}>
        <p class="mt-3 text-sm text-error-fg" role="alert">
          {error()}
        </p>
      </Show>
      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class={buttonClass.secondary}
          disabled={deleting()}
          onClick={() => {
            props.onClose();
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          class={buttonClass.danger}
          disabled={blocked() || !matches() || deleting()}
          onClick={() => void submit()}
        >
          {deleting() ? "Deleting…" : "Delete chain"}
        </button>
      </div>
    </Dialog>
  );
};

const ChainDetailSkeleton = () => (
  <>
    <div class="mb-6 flex flex-col gap-3" aria-busy="true">
      <div class="h-4 w-48 animate-pulse rounded-xs bg-surface-2" />
      <div class="h-7 w-72 animate-pulse rounded-xs bg-surface-2" />
      <div class="h-4 w-96 max-w-full animate-pulse rounded-xs bg-surface-2" />
    </div>
    <SkeletonCard count={4} />
  </>
);

const ChainDetailBody = (props: { id: string }) => {
  const detail = useQuery(() => chainDetailQuery(props.id));
  const jobs = useInfiniteQuery(() => chainJobsQuery(props.id));
  const blocked = useInfiniteQuery(() => blockedJobsQuery({ chainId: props.id }));

  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [openFolds, setOpenFolds] = createSignal<ReadonlySet<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [nearEnd, setNearEnd] = createSignal(false);
  let sentinel!: HTMLDivElement;

  const chain = () => detail.data.chain;
  const completedChain = () => {
    const current = chain();
    return current.status === "completed" ? current : undefined;
  };

  const jobItems = createMemo(() => loadedItems(jobs.data.pages));
  const jobBlockers = createMemo(() => {
    const all: Record<string, UnknownChain[]> = {};
    for (const page of jobs.data.pages) Object.assign(all, page.jobBlockers);
    return all;
  });

  const blockedJobs = createMemo(() =>
    blocked.isPending || blocked.isLoadingError ? [] : loadedItems(blocked.data.pages),
  );

  onSettled(() => {
    const observer = new IntersectionObserver(
      (observed) => {
        setNearEnd(observed.some((entry) => entry.isIntersecting));
      },
      { rootMargin: AUTO_LOAD_MARGIN },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  });

  createEffect(
    () => nearEnd() && shouldLoadNextPage(jobs),
    (shouldLoad) => {
      if (shouldLoad) void jobs.fetchNextPage();
    },
  );

  let previousEntries = new Map<string, JobEntry>();
  const entries = createMemo(() => {
    const next = new Map<string, JobEntry>();
    const result = foldJobs(jobItems(), jobBlockers())
      .flatMap((entry): JobEntry[] => {
        if (entry.kind === "fold" && openFolds().has(entry.jobs[0].id)) {
          return entry.jobs.map((job) => ({ kind: "job", job }));
        }
        return [entry];
      })
      .map((entry) => {
        const key = entryKey(entry);
        const previous = previousEntries.get(key);
        const stable = previous && sameEntry(previous, entry) ? previous : entry;
        next.set(key, stable);
        return stable;
      });
    previousEntries = next;
    return result;
  });

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const jobsLabel = () => formatCount({ count: jobItems().length, hasMore: jobs.hasNextPage });
  const blockedJobsLabel = () =>
    formatCount({ count: blockedJobs().length, hasMore: blocked.hasNextPage });

  return (
    <>
      <PageHeader
        fallback={chainListHref(chain().typeName)}
        crumbs={[
          { label: "Chains", href: "/chains/types" },
          { label: chain().typeName, href: chainListHref(chain().typeName) },
          { label: shortId(chain().id), title: chain().id },
        ]}
      />
      <div class="mb-6 flex flex-wrap items-start gap-4">
        <div class="min-w-0 flex-1">
          <h1 class="flex flex-wrap items-center gap-3 text-base font-semibold">
            <span class="min-w-0 truncate" title={chain().typeName}>
              {chain().typeName}
            </span>
            <StatusPill status={chain().status} />
            <Show when={detail.data.currentJob}>{(job) => <CurrentJobChip job={job()} />}</Show>
          </h1>
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
            <IdChip id={chain().id} full />
            <span>
              Created <Time date={chain().createdAt} />
            </span>
            <Show when={completedChain()}>
              {(completed) => (
                <span>
                  Completed <Time date={completed().completedAt} /> · elapsed{" "}
                  {formatDuration(elapsedMs(completed().createdAt, completed().completedAt))}
                </span>
              )}
            </Show>
            <span>
              Jobs <strong class="font-semibold text-fg tabular-nums">{jobsLabel()}</strong>
            </span>
            <Show when={blockedJobs().length > 0}>
              <span>
                Blocked jobs{" "}
                <strong class="font-semibold text-fg tabular-nums">{blockedJobsLabel()}</strong>
              </span>
            </Show>
          </div>
        </div>
        <ActionsMenu onDelete={() => setDeleteOpen(true)} />
      </div>

      <div class="flex flex-col gap-6">
        <JsonViewer data={chain().input} title="Input" label="chain input" />
        <Show
          when={completedChain()}
          fallback={
            <Box title="Output">
              <p class="text-sm text-fg-subtle">no output yet</p>
            </Box>
          }
        >
          {(completed) => (
            <JsonViewer data={completed().output} title="Output" label="chain output" />
          )}
        </Show>
        <Show when={blockedJobs().length > 0 || blocked.isError}>
          <Box title="Blocked jobs" bodyClass="">
            <Show when={blocked.isError && !blocked.isFetchNextPageError}>
              <div class="p-3">
                <ErrorState
                  thing="blocked jobs"
                  error={blocked.error}
                  onRetry={() => void blocked.refetch()}
                />
              </div>
            </Show>
            <Show when={blockedJobs().length > 0}>
              <VirtualList query={blocked}>{(job) => <BlockedJobRow job={job} />}</VirtualList>
            </Show>
          </Box>
        </Show>
        <div class="min-w-0">
          <Box title="Jobs" bodyClass="px-4 pt-4">
            <ol>
              <For each={entries()}>
                {(entry, index) => {
                  const last = () => index() === entries().length - 1 && !jobs.hasNextPage;
                  return entry.kind === "job" ? (
                    <JobItem
                      job={entry.job}
                      blockers={jobBlockers()[entry.job.id]}
                      last={last()}
                      expanded={expanded().has(entry.job.id)}
                      onToggle={() => {
                        toggleExpanded(entry.job.id);
                      }}
                    />
                  ) : (
                    <FoldItem
                      jobs={entry.jobs}
                      typeName={entry.typeName}
                      last={last()}
                      onExpand={() => setOpenFolds((prev) => new Set(prev).add(entry.jobs[0].id))}
                    />
                  );
                }}
              </For>
            </ol>
            <div
              ref={(element) => {
                sentinel = element;
              }}
              aria-hidden="true"
            />
            <LoadMoreFooter query={jobs} shownCount={jobItems().length} class="-mx-4" />
            <LiveRegion text={loadedAnnouncement(jobs.data.pages, "jobs")} />
          </Box>
        </div>
      </div>

      <DeleteChainDialog
        open={deleteOpen()}
        onClose={() => setDeleteOpen(false)}
        chain={chain()}
        jobsLabel={jobsLabel()}
        blockedJobs={blockedJobs()}
        blockedJobsLabel={blockedJobsLabel()}
      />
    </>
  );
};

const ChainDetailForId = (props: { id: string }) => {
  const detail = useQuery(() => chainDetailQuery(props.id));
  return (
    <div>
      <Show when={detail.isLoadingError}>
        <PageHeader
          fallback="/chains/types"
          crumbs={[{ label: "Chains", href: "/chains/types" }, { label: shortId(props.id) }]}
        />
      </Show>
      <QueryBoundary
        thing="this chain"
        fallback={<ChainDetailSkeleton />}
        notFound={<NotFoundState kind="Chain" href="/chains/types" />}
      >
        <ChainDetailBody id={props.id} />
      </QueryBoundary>
    </div>
  );
};

export const ChainDetail = () => {
  const params = useParams<{ id: string }>();
  return (
    <Show when={params.id} keyed>
      {(id) => <ChainDetailForId id={id} />}
    </Show>
  );
};
