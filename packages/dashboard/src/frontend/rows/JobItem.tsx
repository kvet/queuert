import { A } from "@solidjs/router";
import { type JSX, Show, createSignal } from "solid-js";

import { type UnknownChain, type UnknownJob, errorMessage, rescheduleJob } from "../api.js";
import { jobPhase } from "../domain/jobPhase.js";
import { formatRelative } from "../domain/time.js";
import { now } from "../state/clock.js";
import { ChevronRightIcon } from "../ui/icons.js";
import { IdChip } from "../ui/IdChip.js";
import { JsonViewer } from "../ui/JsonViewer.js";
import { buttonClass } from "../ui/kit.js";
import { ErrorMark } from "../ui/Pips.js";
import { type AnyStatus, statusClasses } from "../ui/status.js";
import { StatusPill } from "../ui/StatusPill.js";
import { Time } from "../ui/Time.js";
import { BlockerChips, blockerProgress } from "./BlockerChips.js";

/** An entry in the chain sequence: a numbered node coloured by status, connected down to the next. */
const SequenceItem = (props: {
  label: string;
  status: AnyStatus;
  last: boolean;
  children: JSX.Element;
}) => (
  <li class="flex gap-3">
    <div class="flex flex-col items-center">
      <span
        class={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-xs px-1.5 text-xs font-semibold tabular-nums ring-4 ring-bg ${statusClasses[props.status].pill} ${
          props.status === "running" ? "animate-pulse-ring" : ""
        }`}
      >
        {props.label}
      </span>
      <Show when={!props.last}>
        <span class="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
      </Show>
    </div>
    <div class="min-w-0 flex-1 pb-5">{props.children}</div>
  </li>
);

/** Shown only for a pending job scheduled in the future; failures are reported inline. */
export const RescheduleButton = (props: {
  job: UnknownJob;
  label: string;
  onRescheduled: (job: UnknownJob) => void;
  class?: string;
}) => {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  return (
    <Show when={props.job.status === "pending" && props.job.scheduledAt.getTime() > now()}>
      <span class={`inline-flex flex-col items-end gap-1 ${props.class ?? ""}`}>
        <button
          type="button"
          class={buttonClass.secondary}
          disabled={busy()}
          onClick={() => {
            setBusy(true);
            setError(null);
            rescheduleJob(props.job.id).then(
              (job) => {
                setBusy(false);
                props.onRescheduled(job);
              },
              (err: unknown) => {
                setBusy(false);
                setError(errorMessage(err));
              },
            );
          }}
        >
          {busy() ? "Running…" : props.label}
        </button>
        <Show when={error()}>
          <span class="text-xs text-error-fg" role="alert">
            {error()}
          </span>
        </Show>
      </span>
    </Show>
  );
};

/** Full error text, mono and pre-wrapped, collapsed to `lines` with a "Show full message" toggle. */
export const ErrorText = (props: { text: string; lines: 3 | 12 }) => {
  const [full, setFull] = createSignal(false);
  // Approximates whether the clamp cuts text off, assuming ~90 characters per wrapped line.
  const long = () =>
    props.text.split("\n").length > props.lines || props.text.length > props.lines * 90;
  const clamp = () => (props.lines === 3 ? "line-clamp-3" : "line-clamp-[12]");

  return (
    <div>
      <pre
        class={`font-mono text-xs leading-5 break-words whitespace-pre-wrap text-error-fg ${
          full() ? "" : clamp()
        }`}
      >
        {props.text}
      </pre>
      <Show when={long()}>
        <button
          type="button"
          class="mt-1 text-xs text-fg-muted hover:text-fg hover:underline"
          onClick={() => setFull((value) => !value)}
        >
          {full() ? "Show less" : "Show full message"}
        </button>
      </Show>
    </div>
  );
};

export const JobItem = (props: {
  job: UnknownJob;
  blockers: UnknownChain[] | undefined;
  last: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRescheduled: (job: UnknownJob) => void;
}) => {
  const phase = () => jobPhase(props.job, now());
  const blockers = () => props.blockers ?? [];
  const completedTail = () =>
    props.job.status === "completed" && props.job.continuedToId === null ? props.job : undefined;
  const continuedToId = () =>
    props.job.status === "completed" && props.job.continuedToId !== null
      ? props.job.continuedToId
      : undefined;

  return (
    <SequenceItem
      label={String(props.job.chainIndex + 1)}
      status={props.job.status}
      last={props.last}
    >
      <div class="flex min-h-6 items-center gap-2">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
          <A
            href={`/jobs/${props.job.id}`}
            class="min-w-0 truncate font-medium hover:underline"
            title={props.job.typeName}
          >
            {props.job.typeName}
          </A>
          <StatusPill status={props.job.status} />
          <IdChip id={props.job.id} />
        </div>
        <span class="hidden shrink-0 text-xs whitespace-nowrap text-fg-muted sm:inline">
          <Time date={props.job.createdAt} />
        </span>
        <button
          type="button"
          class={buttonClass.toggle}
          aria-expanded={props.expanded}
          onClick={() => {
            props.onToggle();
          }}
        >
          <ChevronRightIcon
            size={12}
            class={`transition-transform ${props.expanded ? "rotate-90" : ""}`}
          />
          details
        </button>
      </div>

      <Show when={phase().phase === "rescheduledAfterError"}>
        <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <ErrorMark text="Rescheduled after error" />
          <span>
            {props.job.attempt} {props.job.attempt === 1 ? "attempt" : "attempts"}
          </span>
          <span>·</span>
          <Show when={props.job.scheduledAt.getTime() > now()} fallback={<span>due now</span>}>
            <span>next attempt {formatRelative(props.job.scheduledAt, now())}</span>
          </Show>
          <span class="flex-1" />
          <RescheduleButton job={props.job} label="Run now" onRescheduled={props.onRescheduled} />
        </div>
      </Show>
      <Show when={phase().phase === "running" && props.job.lastAttemptError != null}>
        <div class="mt-1.5 text-xs">
          <ErrorMark text="an earlier attempt failed" />
        </div>
      </Show>

      <Show when={props.job.lastAttemptError}>
        {(error) => (
          <div class="mt-2 rounded-xs border border-error-border bg-error-bg px-3 py-2">
            <ErrorText text={error()} lines={3} />
          </div>
        )}
      </Show>

      <Show when={blockers().length > 0}>
        <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-fg-muted">
          <span>{props.job.status === "blocked" ? "Waiting on" : "Waited on"}</span>
          <strong class="font-semibold text-fg">{blockerProgress(blockers())}</strong>
          <BlockerChips blockers={blockers()} />
        </div>
      </Show>

      <Show when={props.expanded}>
        <div class="mt-3">
          <div class="flex flex-col gap-4">
            <JsonViewer data={props.job.input} title="Input" label="input" />
            <Show when={completedTail()}>
              {(tail) => <JsonViewer data={tail().output} title="Output" label="output" />}
            </Show>
          </div>
          <Show when={continuedToId()}>
            {(nextId) => (
              <p class="mt-2 text-xs text-fg-muted">
                Continued to{" "}
                <A href={`/jobs/${nextId()}`} class="text-accent-fg hover:underline">
                  → job #{props.job.chainIndex + 2}
                </A>
              </p>
            )}
          </Show>
        </div>
      </Show>
    </SequenceItem>
  );
};

/** A run of repeated completed jobs, collapsed. */
export const FoldItem = (props: {
  jobs: UnknownJob[];
  typeName: string;
  last: boolean;
  onExpand: () => void;
}) => {
  const firstJob = () => props.jobs[0];
  const lastJob = () => props.jobs[props.jobs.length - 1];
  const lastCompletedAt = () => {
    const job = lastJob();
    return job.status === "completed" ? job.completedAt : job.createdAt;
  };

  return (
    <SequenceItem
      label={`${firstJob().chainIndex + 1}–${lastJob().chainIndex + 1}`}
      status="completed"
      last={props.last}
    >
      <div class="flex min-h-6 items-center gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <span class="min-w-0 truncate font-medium" title={props.typeName}>
            {props.typeName}
          </span>
          <span class="shrink-0 rounded-xs bg-surface-2 px-2 py-0.5 text-xs whitespace-nowrap text-fg-muted">
            ×{props.jobs.length} jobs
          </span>
        </div>
        <span class="hidden shrink-0 text-xs whitespace-nowrap text-fg-muted sm:inline">
          <Time date={firstJob().createdAt} /> → <Time date={lastCompletedAt()} />
        </span>
        <button
          type="button"
          class={buttonClass.toggle}
          onClick={() => {
            props.onExpand();
          }}
        >
          <ChevronRightIcon size={12} />
          expand
        </button>
      </div>
    </SequenceItem>
  );
};
