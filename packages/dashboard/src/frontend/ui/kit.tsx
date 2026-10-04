import { A } from "@solidjs/router";
import { For, type JSX, Show, createEffect } from "solid-js";

import { errorMessage } from "../api.js";
import { CloseIcon } from "./icons.js";

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-xs bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-950",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-xs border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-xs px-2 py-1 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50",
  /** Small bordered toggle for inline disclosure controls; filled while open or pressed. */
  toggle:
    "inline-flex shrink-0 items-center gap-1 rounded-xs border border-border-strong px-1.5 py-0.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg aria-pressed:bg-surface-2 aria-pressed:text-fg",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-xs bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
} as const;

export const linkClass = "text-accent-fg hover:underline";

/**
 * A TUI-style box (`┌─ TITLE ──── actions ─┐`): the title and actions sit on the top border. Boxes
 * are unfilled, so the labels' page-coloured background cuts the border cleanly at any nesting.
 */
export const Card = (props: {
  title?: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element;
  tone?: "error";
  class?: string;
  bodyClass?: string;
}) => {
  return (
    <section
      class={`relative rounded-xs border ${props.tone === "error" ? "border-error-border" : "border-border"} ${
        props.title ? "pt-2" : ""
      } ${props.class ?? ""}`}
    >
      <Show when={props.title}>
        <header class="absolute inset-x-3 top-0 flex -translate-y-1/2 items-center justify-between gap-3">
          <h2
            class={`min-w-0 truncate bg-bg px-1.5 text-xs font-semibold tracking-wider uppercase ${
              props.tone === "error" ? "text-error-fg" : "text-fg-muted"
            }`}
          >
            {props.title}
          </h2>
          <Show when={props.actions}>
            <div class="flex shrink-0 items-center gap-1 bg-bg px-1 text-xs">{props.actions}</div>
          </Show>
        </header>
      </Show>
      <div class={props.bodyClass ?? "p-4"}>{props.children}</div>
    </section>
  );
};

/**
 * Full-row link overlay: the row is `relative`, this link fills it, and inner interactive
 * elements sit above it with `relative z-10` and come after it in focus order.
 */
export const RowLink = (props: { href: string; label: string }) => {
  return (
    <A
      href={props.href}
      class="absolute inset-0 rounded-[inherit] focus-visible:outline-offset-[-2px]"
      aria-label={props.label}
    />
  );
};

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

export const NotFoundState = (props: { kind: "Chain" | "Job"; href: string }) => {
  return (
    <EmptyState title={`${props.kind} not found`}>
      <A href={props.href} class={linkClass}>
        Go to the {props.kind.toLowerCase()} list
      </A>
    </EmptyState>
  );
};

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

/** Polite live region for list announcements ("Loaded 100 more"). */
export const LiveRegion = (props: { text: string }) => {
  return (
    <div class="sr-only" aria-live="polite">
      {props.text}
    </div>
  );
};

/**
 * Native modal `<dialog>`: the browser traps focus, closes on Esc, and returns focus to the
 * trigger. A click on the backdrop closes it too. While `busy`, it stays open.
 */
export const Dialog = (props: {
  open: boolean;
  onClose: () => void;
  title: string;
  busy?: boolean;
  children: JSX.Element;
  class?: string;
}) => {
  let dialog!: HTMLDialogElement;
  // Where the press started: a text selection dragged out onto the backdrop is not a backdrop click.
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
