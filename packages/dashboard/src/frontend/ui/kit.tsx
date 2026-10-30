import { CloseIcon } from "@queuert/ui/components";
import { A } from "@solidjs/router";
import { For, type JSX, Show, createEffect } from "solid-js";

import { errorMessage } from "../api.js";

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-xs bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-950",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-xs border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-xs px-2 py-1 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50",
  toggle:
    "inline-flex shrink-0 items-center gap-1 rounded-xs border border-border-strong px-1.5 py-0.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg aria-pressed:bg-surface-2 aria-pressed:text-fg",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-xs bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
} as const;

export const linkClass = "text-accent-fg hover:underline";

export const EmptyState = (props: { title: string; children?: JSX.Element }) => {
  return (
    <div class="rounded-xs border border-dashed border-border-strong px-6 py-10 text-center">
      <p class="text-sm font-medium">{props.title}</p>
      <Show when={props.children}>
        <div class="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-fg-muted">
          {props.children}
        </div>
      </Show>
    </div>
  );
};

export const ErrorState = (props: { thing: string; error: unknown; onRetry: () => void }) => {
  return (
    <div
      class="flex flex-wrap items-center gap-3 rounded-xs border border-error-border bg-error-bg px-4 py-3 text-sm text-error-fg"
      role="alert"
    >
      <span class="min-w-0 flex-1 break-words">
        Couldn't load {props.thing}: {errorMessage(props.error)}
      </span>
      <button
        type="button"
        class={buttonClass.secondary}
        onClick={() => {
          props.onRetry();
        }}
      >
        Retry
      </button>
    </div>
  );
};

export const NotFoundState = (props: {
  kind: "Chain" | "Job" | "Worker";
  href: string;
  children?: JSX.Element;
}) => {
  return (
    <EmptyState title={`${props.kind} not found`}>
      <Show when={props.children}>
        <p class="w-full">{props.children}</p>
      </Show>
      <A href={props.href} class={linkClass}>
        Go to the {props.kind.toLowerCase()} list
      </A>
    </EmptyState>
  );
};

export const Fact = (props: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: JSX.Element;
}) => (
  <div class={`min-w-0 ${props.wide ? "col-span-2" : ""}`}>
    <dt class="text-xs text-fg-muted" title={props.hint}>
      {props.label}
      <Show when={props.hint}>
        <span class="ml-1 cursor-help text-fg-subtle" aria-label={props.hint}>
          ⓘ
        </span>
      </Show>
    </dt>
    <dd class="mt-0.5 text-sm break-words">{props.children}</dd>
  </div>
);

export const SkeletonRows = (props: { count?: number; class?: string }) => {
  return (
    <div class="divide-y divide-border" aria-busy="true" aria-label="Loading">
      <For each={Array.from({ length: props.count ?? 6 })}>
        {() => (
          <div class={`flex flex-col gap-2 px-4 py-3 ${props.class ?? ""}`}>
            <div class="h-4 w-2/3 animate-pulse rounded-xs bg-surface-2" />
            <div class="h-3 w-1/2 animate-pulse rounded-xs bg-surface-2" />
          </div>
        )}
      </For>
    </div>
  );
};

export const LiveRegion = (props: { text: string }) => {
  return (
    <div class="sr-only" aria-live="polite">
      {props.text}
    </div>
  );
};

export const Dialog = (props: {
  open: boolean;
  onClose: () => void;
  title: string;
  busy?: boolean;
  children: JSX.Element;
  class?: string;
}) => {
  let dialog!: HTMLDialogElement;
  let pressedBackdrop = false;

  createEffect(() => {
    if (props.open && !dialog.open) dialog.showModal();
    else if (!props.open && dialog.open) dialog.close();
  });

  return (
    <dialog
      ref={(element) => {
        dialog = element;
      }}
      class={`m-auto w-[min(560px,calc(100vw-32px))] rounded-xs border border-border bg-surface p-0 text-fg shadow-2xl ${props.class ?? ""}`}
      aria-label={props.title}
      onClose={() => {
        props.onClose();
      }}
      onCancel={(event) => {
        if (props.busy) event.preventDefault();
      }}
      onPointerDown={(event) => {
        pressedBackdrop = event.target === dialog;
      }}
      onClick={(event) => {
        if (event.target === dialog && pressedBackdrop && !props.busy) dialog.close();
      }}
    >
      <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 class="text-sm font-semibold">{props.title}</h2>
        <button
          type="button"
          class={buttonClass.ghost}
          aria-label="Close"
          disabled={props.busy}
          onClick={() => {
            dialog.close();
          }}
        >
          <CloseIcon />
        </button>
      </div>
      <div class="p-4">{props.children}</div>
    </dialog>
  );
};
