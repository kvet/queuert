import { Box, MoreIcon, StatusDot, StatusPill } from "@queuert/ui/components";
import { shortId } from "@queuert/ui/lib";
import { A, useNavigate, useParams } from "@solidjs/router";
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

import {
  type UnknownChain,
  type UnknownJob,
  ApiError,
  deleteChain,
  errorMessage,
  getChainBlocking,
  getChainDetail,
  getChainJobs,
  isAbort,
  isNotFound,
} from "../api.js";
import { elapsedMs, formatDuration } from "../domain/duration.js";
import { type JobEntry, foldJobs } from "../domain/foldJobs.js";
import { BlockedJobRow } from "../rows/BlockedJobRow.js";
import { FoldItem, JobItem } from "../rows/JobItem.js";
import { PageHeader } from "../shell/PageHeader.js";
import { createAutoLoadMore } from "../state/createAutoLoadMore.js";
import { IdChip } from "../ui/IdChip.js";
import { JsonViewer } from "../ui/JsonViewer.js";
import {
  Dialog,
  ErrorState,
  LiveRegion,
  NotFoundState,
  SkeletonRows,
  buttonClass,
} from "../ui/kit.js";
import { Time } from "../ui/Time.js";

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

  const onPointer = (event: PointerEvent) => {
    if (!root.contains(event.target as Node)) setOpen(false);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
  };
  document.addEventListener("pointerdown", onPointer);
  document.addEventListener("keydown", onKey);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onPointer);
    document.removeEventListener("keydown", onKey);
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
        class={`${buttonClass.secondary} px-2`}
        aria-label="More actions"
        aria-expanded={open()}
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
  <A
    href={`/jobs/${props.job.id}`}
    class="inline-flex shrink-0 items-center gap-1.5 rounded-xs border border-border px-2 py-0.5 text-xs font-normal tracking-normal text-fg-muted hover:border-border-strong hover:text-fg"
    title={`${props.job.typeName} · ${props.job.id}`}
  >
    current job
    <span class="font-medium text-fg tabular-nums">#{props.job.chainIndex + 1}</span>
    <StatusDot status={props.job.status} />
    {props.job.status}
  </A>
);

const DeleteChainDialog = (props: {
  open: boolean;
  onClose: () => void;
  chain: UnknownChain;
  jobsLabel: string;
  blockedJobs: UnknownJob[];
  blockedJobsLabel: string;
  onBlocked: () => void;
}) => {
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = createSignal("");
  const [deleting, setDeleting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const blocked = () => props.blockedJobs.length > 0;
  const matches = () => confirmText() === props.chain.id;

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) {
          setConfirmText("");
          setError(null);
        }
      },
    ),
  );

  const submit = async () => {
    if (!matches() || blocked() || deleting()) return;
    setDeleting(true);
    setError(null);
    const leave = () => {
      props.onClose();
      navigate(chainListHref(props.chain.typeName));
    };
    try {
      await deleteChain(props.chain.id);
      leave();
    } catch (err) {
      if (isNotFound(err)) {
        leave();
        return;
      }
      setError(errorMessage(err));
      if (err instanceof ApiError && err.status === 409) props.onBlocked();
    } finally {
      setDeleting(false);
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
            <A
              href={`/jobs/${blockedJob().id}`}
              class="underline"
              onClick={() => {
                props.onClose();
              }}
            >
              job {blockedJob().typeName} {shortId(blockedJob().id)}
            </A>
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

export const ChainDetail = () => {
  const params = useParams<{ id: string }>();

  const [chain, setChain] = createSignal<UnknownChain>();
  const [currentJob, setCurrentJob] = createSignal<UnknownJob | null>(null);
  const [jobs, setJobs] = createSignal<UnknownJob[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [jobBlockers, setJobBlockers] = createSignal<Record<string, UnknownChain[]>>({});
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<unknown>();
  const [announcement, setAnnouncement] = createSignal("");

  const [blockedJobs, setBlockedJobs] = createSignal<UnknownJob[]>([]);
  const [blockedJobsCursor, setBlockedJobsCursor] = createSignal<string | null>(null);
  const [blockedJobsError, setBlockedJobsError] = createSignal<unknown>();
  const [blockedJobsLoadingMore, setBlockedJobsLoadingMore] = createSignal(false);

  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [openFolds, setOpenFolds] = createSignal<ReadonlySet<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = createSignal(false);

  let loadController: AbortController | null = null;
  let jobsMoreController: AbortController | null = null;
  let blockedJobsController: AbortController | null = null;

  const abortAll = () => {
    for (const controller of [loadController, jobsMoreController, blockedJobsController]) {
      controller?.abort();
    }
  };
  onCleanup(abortAll);

  const completedChain = () => {
    const current = chain();
    return current?.status === "completed" ? current : undefined;
  };

  const loadBlockedJobs = async (id: string) => {
    blockedJobsController?.abort();
    const own = new AbortController();
    blockedJobsController = own;
    setBlockedJobsError(undefined);
    try {
      const page = await getChainBlocking(id, { signal: own.signal });
      if (own.signal.aborted) return;
      setBlockedJobs(page.items);
      setBlockedJobsCursor(page.nextCursor);
    } catch (err) {
      if (own.signal.aborted || isAbort(err)) return;
      setBlockedJobsError(err);
    }
  };

  const load = async (id: string) => {
    abortAll();
    const own = new AbortController();
    loadController = own;
    setChain(undefined);
    setCurrentJob(null);
    setJobs([]);
    setNextCursor(null);
    setJobBlockers({});
    setBlockedJobs([]);
    setBlockedJobsCursor(null);
    setError(undefined);
    setLoading(true);
    setExpanded(new Set<string>());
    setOpenFolds(new Set<string>());
    setDeleteOpen(false);
    void loadBlockedJobs(id);
    try {
      const detail = await getChainDetail(id, { signal: own.signal });
      if (own.signal.aborted) return;
      setChain(detail.chain);
      setCurrentJob(detail.currentJob);
      setJobs(detail.jobs);
      setNextCursor(detail.nextCursor);
      setJobBlockers(detail.jobBlockers);
    } catch (err) {
      if (own.signal.aborted || isAbort(err)) return;
      setError(err);
    } finally {
      if (loadController === own) setLoading(false);
    }
  };

  createEffect(
    on(
      () => params.id,
      (id) => void load(id),
    ),
  );

  const loadMoreJobs = async () => {
    const cursor = nextCursor();
    if (!cursor) return;
    const own = new AbortController();
    jobsMoreController = own;
    const page = await getChainJobs(params.id, { cursor, signal: own.signal }).catch(
      (err: unknown) => {
        if (own.signal.aborted) return undefined;
        throw err;
      },
    );
    if (!page || own.signal.aborted) return;
    setJobs((prev) => [...prev, ...page.jobs]);
    setNextCursor(page.nextCursor);
    setJobBlockers((prev) => ({ ...prev, ...page.jobBlockers }));
    setAnnouncement(`Loaded ${page.jobs.length} more jobs`);
  };
  const autoLoadMoreJobs = createAutoLoadMore(loadMoreJobs);

  const loadMoreBlockedJobs = async () => {
    const cursor = blockedJobsCursor();
    if (!cursor || blockedJobsLoadingMore()) return;
    setBlockedJobsLoadingMore(true);
    const own = new AbortController();
    blockedJobsController = own;
    try {
      const page = await getChainBlocking(params.id, { cursor, signal: own.signal });
      if (own.signal.aborted) return;
      setBlockedJobs((prev) => [
        ...prev,
        ...page.items.filter((job) => !prev.some((existing) => existing.id === job.id)),
      ]);
      setBlockedJobsCursor(page.nextCursor);
      setBlockedJobsError(undefined);
    } catch (err) {
      if (own.signal.aborted || isAbort(err)) return;
      setBlockedJobsError(err);
    } finally {
      setBlockedJobsLoadingMore(false);
    }
  };

  const replaceJob = (updated: UnknownJob) => {
    if (currentJob()?.id === updated.id) setCurrentJob(updated);
    setJobs((prev) => prev.map((job) => (job.id === updated.id ? updated : job)));
  };

  let previousEntries = new Map<string, JobEntry>();
  const entries = createMemo(() => {
    const next = new Map<string, JobEntry>();
    const result = foldJobs(jobs(), jobBlockers())
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

  const jobsLabel = () => `${jobs().length}${nextCursor() ? "+" : ""}`;
  const blockedJobsLabel = () => `${blockedJobs().length}${blockedJobsCursor() ? "+" : ""}`;

  return (
    <div>
      <Switch>
        <Match when={error()}>
          <PageHeader
            fallback="/chains/types"
            crumbs={[{ label: "Chains", href: "/chains/types" }, { label: shortId(params.id) }]}
          />
          <Show
            when={isNotFound(error())}
            fallback={
              <ErrorState thing="this chain" error={error()} onRetry={() => void load(params.id)} />
            }
          >
            <NotFoundState kind="Chain" href="/chains/types" />
          </Show>
        </Match>
        <Match when={loading() || !chain()}>
          <div class="mb-6 flex flex-col gap-3" aria-busy="true">
            <div class="h-4 w-48 animate-pulse rounded-xs bg-surface-2" />
            <div class="h-7 w-72 animate-pulse rounded-xs bg-surface-2" />
            <div class="h-4 w-96 max-w-full animate-pulse rounded-xs bg-surface-2" />
          </div>
          <div class="rounded-xs border border-border">
            <SkeletonRows count={4} />
          </div>
        </Match>
        <Match when={chain()}>
          {(current) => (
            <>
              <PageHeader
                fallback={chainListHref(current().typeName)}
                crumbs={[
                  { label: "Chains", href: "/chains/types" },
                  { label: current().typeName, href: chainListHref(current().typeName) },
                  { label: shortId(current().id), title: current().id },
                ]}
              />
              <div class="mb-6 flex flex-wrap items-start gap-4">
                <div class="min-w-0 flex-1">
                  <h1 class="flex flex-wrap items-center gap-3 text-base font-semibold">
                    <span class="min-w-0 truncate" title={current().typeName}>
                      {current().typeName}
                    </span>
                    <StatusPill status={current().status} />
                    <Show when={currentJob()}>{(job) => <CurrentJobChip job={job()} />}</Show>
                  </h1>
                  <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
                    <IdChip id={current().id} full />
                    <span>
                      Created <Time date={current().createdAt} />
                    </span>
                    <Show when={completedChain()}>
                      {(completed) => (
                        <span>
                          Completed <Time date={completed().completedAt} /> · elapsed{" "}
                          {formatDuration(
                            elapsedMs(completed().createdAt, completed().completedAt),
                          )}
                        </span>
                      )}
                    </Show>
                    <span>
                      Jobs <strong class="font-semibold text-fg tabular-nums">{jobsLabel()}</strong>
                    </span>
                    <Show when={blockedJobs().length > 0}>
                      <span>
                        Blocked jobs{" "}
                        <strong class="font-semibold text-fg tabular-nums">
                          {blockedJobsLabel()}
                        </strong>
                      </span>
                    </Show>
                  </div>
                </div>
                <ActionsMenu onDelete={() => setDeleteOpen(true)} />
              </div>

              <div class="flex flex-col gap-6">
                <JsonViewer data={current().input} title="Input" label="chain input" />
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
                <Show when={blockedJobs().length > 0 || blockedJobsError()}>
                  <Box title="Blocked jobs" bodyClass="">
                    <Show when={blockedJobsError()}>
                      <div class="p-3">
                        <ErrorState
                          thing="blocked jobs"
                          error={blockedJobsError()}
                          onRetry={() => void loadBlockedJobs(params.id)}
                        />
                      </div>
                    </Show>
                    <ul class="divide-y divide-border">
                      <For each={blockedJobs()}>{(job) => <BlockedJobRow job={job} />}</For>
                    </ul>
                    <Show when={blockedJobsCursor() && !blockedJobsError()}>
                      <div class="border-t border-border px-4 py-3">
                        <button
                          type="button"
                          class={buttonClass.secondary}
                          disabled={blockedJobsLoadingMore()}
                          onClick={() => void loadMoreBlockedJobs()}
                        >
                          {blockedJobsLoadingMore() ? "Loading…" : "Load more"}
                        </button>
                      </div>
                    </Show>
                  </Box>
                </Show>
                <div class="min-w-0">
                  <Box title="Jobs" bodyClass="px-4 pt-4">
                    <ol>
                      <For each={entries()}>
                        {(entry, index) => {
                          const last = () => index() === entries().length - 1 && !nextCursor();
                          return entry.kind === "job" ? (
                            <JobItem
                              job={entry.job}
                              blockers={jobBlockers()[entry.job.id]}
                              last={last()}
                              expanded={expanded().has(entry.job.id)}
                              onToggle={() => {
                                toggleExpanded(entry.job.id);
                              }}
                              onRescheduled={replaceJob}
                            />
                          ) : (
                            <FoldItem
                              jobs={entry.jobs}
                              typeName={entry.typeName}
                              last={last()}
                              onExpand={() =>
                                setOpenFolds((prev) => new Set(prev).add(entry.jobs[0].id))
                              }
                            />
                          );
                        }}
                      </For>
                    </ol>
                    <Show when={nextCursor()}>
                      <div class="-mx-4 flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-fg-muted">
                        <span>
                          Showing {jobs().length.toLocaleString()} jobs · more load as you scroll
                        </span>
                        <button
                          type="button"
                          class={buttonClass.secondary}
                          ref={autoLoadMoreJobs.ref}
                          disabled={autoLoadMoreJobs.loading()}
                          onClick={() => {
                            autoLoadMoreJobs.trigger();
                          }}
                        >
                          {autoLoadMoreJobs.loading()
                            ? "Loading…"
                            : autoLoadMoreJobs.failed()
                              ? "Retry"
                              : "Load more"}
                        </button>
                      </div>
                    </Show>
                    <LiveRegion text={announcement()} />
                  </Box>
                </div>
              </div>

              <DeleteChainDialog
                open={deleteOpen()}
                onClose={() => setDeleteOpen(false)}
                chain={current()}
                jobsLabel={jobsLabel()}
                blockedJobs={blockedJobs()}
                blockedJobsLabel={blockedJobsLabel()}
                onBlocked={() => void loadBlockedJobs(params.id)}
              />
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
};
