import { Listbox } from "@kobalte/core/listbox";
import { StatusPill } from "@queuert/ui/components";
import { useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { Match, Show, Switch, createMemo, createSignal } from "solid-js";

import { MAX_IDS } from "../../shared/limits.ts";
import { errorMessage, serverFns } from "../api.ts";
import { appHref } from "../base.ts";
import {
  type FindChoice,
  type FindOption,
  type TypeSuggestion,
  choiceHref,
  findOptions,
  typeSuggestionHref,
} from "../domain/findOptions.ts";
import { parseIdList } from "../domain/ids.ts";
import { matchTypeNames } from "../domain/typeMatch.ts";
import { chainTypeNamesQuery, jobTypeNamesQuery } from "../state/queries.ts";
import { Dialog, buttonClass } from "../ui/kit.tsx";

const [findOpen, setFindOpen] = createSignal(false);

export const openFind = (): void => {
  setFindOpen(true);
};

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export const handleFindShortcut = (event: KeyboardEvent): void => {
  if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
  const inDialog = event.target instanceof Element && event.target.closest("[data-find-dialog]");
  if (isTypingTarget(event.target) && !inDialog) return;
  event.preventDefault();
  setFindOpen(true);
};

const TYPE_SUGGESTIONS = 5;

const OptionLabel = (props: { option: FindOption }) => (
  <Switch>
    <Match when={"suggestion" in props.option && props.option.suggestion}>
      {(suggestion) => (
        <>
          <span class="shrink-0 text-fg-muted">
            {suggestion().kind === "chain" ? "Chain type" : "Job type"}
          </span>
          <span class="text-fg-subtle">·</span>
          <span class="truncate font-mono font-medium">{suggestion().typeName}</span>
        </>
      )}
    </Match>
    <Match
      when={
        "choice" in props.option &&
        props.option.choice.kind === "chain" &&
        props.option.choice.chain
      }
    >
      {(chain) => (
        <>
          <span class="font-medium">Chain</span>
          <span class="text-fg-subtle">·</span>
          <span class="truncate font-mono">{chain().typeName}</span>
          <span class="flex-1" />
          <StatusPill status={chain().status} />
        </>
      )}
    </Match>
    <Match
      when={
        "choice" in props.option && props.option.choice.kind === "job" && props.option.choice.job
      }
    >
      {(job) => (
        <>
          <span class="font-medium">Job</span>
          <span class="text-fg-subtle">·</span>
          <span class="truncate font-mono">{job().typeName}</span>
          <span class="text-fg-subtle">·</span>
          <span class="text-fg-muted">job #{job().chainIndex + 1}</span>
          <span class="flex-1" />
          <StatusPill status={job().status} />
        </>
      )}
    </Match>
    <Match
      when={
        "choice" in props.option &&
        props.option.choice.kind === "worker" &&
        props.option.choice.worker
      }
    >
      {(worker) => (
        <>
          <span class="font-medium">Worker</span>
          <span class="text-fg-subtle">·</span>
          <span class="truncate font-mono">{worker().typeNames.join(", ")}</span>
          <span class="flex-1" />
          <span class="shrink-0 text-xs text-fg-muted tabular-nums">
            {worker().runningJobCount} / {worker().concurrency} running
          </span>
        </>
      )}
    </Match>
  </Switch>
);

export const FindDialog = () => {
  const navigate = useNavigate();
  const [text, setText] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [message, setMessage] = createSignal<{ text: string; error: boolean } | null>(null);
  const [choices, setChoices] = createSignal<FindChoice[]>([]);
  let input: HTMLTextAreaElement | undefined;
  let results: HTMLUListElement | undefined;
  let controller: AbortController | null = null;

  const parsed = () => parseIdList(text());

  const chainTypeNames = useQuery(() => ({ ...chainTypeNamesQuery(), enabled: findOpen() }));
  const jobTypeNames = useQuery(() => ({ ...jobTypeNamesQuery(), enabled: findOpen() }));
  const suggestions = createMemo((): TypeSuggestion[] => {
    if (!chainTypeNames.isSuccess || !jobTypeNames.isSuccess) return [];
    if (choices().length > 0 || /[,\n]/.test(text())) return [];
    return [
      ...matchTypeNames(chainTypeNames.data, text(), TYPE_SUGGESTIONS).map((typeName) => ({
        kind: "chain" as const,
        typeName,
      })),
      ...matchTypeNames(jobTypeNames.data, text(), TYPE_SUGGESTIONS).map((typeName) => ({
        kind: "job" as const,
        typeName,
      })),
    ];
  });
  const options = () => findOptions(choices(), suggestions());

  const open = (href: string) => {
    close();
    navigate(appHref(href));
  };

  const close = () => {
    setFindOpen(false);
    controller?.abort();
    setText("");
    setMessage(null);
    setChoices([]);
    setSearching(false);
  };

  const submit = async () => {
    const { ids } = parsed();
    if (ids.length === 0) return;
    if (ids.length > 1 && suggestions().length > 0) {
      open(typeSuggestionHref(suggestions()[0]));
      return;
    }
    if (ids.length > 1) {
      close();
      navigate(appHref(`/find?ids=${encodeURIComponent(ids.join(","))}`));
      return;
    }
    controller?.abort();
    const own = new AbortController();
    controller = own;
    setSearching(true);
    setMessage(null);
    setChoices([]);
    try {
      const [chains, jobs, workers] = await Promise.all([
        serverFns.getChains({ data: { ids }, signal: own.signal }),
        serverFns.getJobs({ data: { ids }, signal: own.signal }),
        serverFns.getWorkers({ data: { ids }, signal: own.signal }),
      ]);
      if (own.signal.aborted) return;
      const found: FindChoice[] = [
        ...chains.map((chain) => ({ kind: "chain" as const, chain })),
        ...jobs.map((job) => ({ kind: "job" as const, job })),
        ...workers.map((worker) => ({ kind: "worker" as const, worker })),
      ];
      const topSuggestion = suggestions()[0];
      if (found.length === 0 && topSuggestion) open(typeSuggestionHref(topSuggestion));
      else if (found.length === 0)
        setMessage({ text: "No chain, job or worker with this ID", error: false });
      else if (found.length === 1) open(choiceHref(found[0]));
      else setChoices(found);
    } catch (error) {
      if (own.signal.aborted) return;
      setMessage({ text: `Lookup failed: ${errorMessage(error)}`, error: true });
    } finally {
      if (controller === own) setSearching(false);
    }
  };

  return (
    <Dialog open={findOpen()} onClose={close} title="Find by ID or type" class="mt-[12vh]">
      <div data-find-dialog>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label class="sr-only" for="find-ids">
            Chain, job or worker IDs, or a type name
          </label>
          <textarea
            ref={(element) => {
              input = element;
            }}
            id="find-ids"
            autofocus
            rows={2}
            class="w-full resize-y rounded-xs border border-border-strong bg-surface px-3 py-2 font-mono text-sm placeholder:text-fg-subtle"
            placeholder="Paste IDs (separated by commas, spaces or new lines) or type a type name"
            value={text()}
            onInput={(event) => {
              setText(event.currentTarget.value);
              setMessage(null);
              setChoices([]);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && options().length > 0) {
                event.preventDefault();
                results?.focus();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <Switch fallback={<span>Enter to search · Shift+Enter for a new line</span>}>
              <Match when={parsed().overLimit}>
                <span class="text-error-fg">Max {MAX_IDS} IDs</span>
              </Match>
              <Match when={suggestions().length > 0}>
                <span>Enter to open the top type or a matching ID · ↓ to pick a type</span>
              </Match>
              <Match when={parsed().ids.length > 1}>
                <span>{parsed().ids.length} IDs · Enter to list them all</span>
              </Match>
            </Switch>
            <span class="flex-1" />
            <button
              type="submit"
              class={buttonClass.primary}
              disabled={searching() || parsed().ids.length === 0}
            >
              {searching() ? "Searching…" : "Find"}
            </button>
          </div>
        </form>

        <Show when={message()}>
          {(message) => (
            <p
              class={["mt-3 text-sm", message().error ? "text-error-fg" : "text-fg-muted"]}
              role="status"
            >
              {message().text}
            </p>
          )}
        </Show>

        <Show when={choices().length > 0}>
          <p class="mt-3 mb-2 text-xs text-fg-muted">
            {choices().some((choice) => choice.kind === "worker")
              ? "Several items have this ID. Choose one:"
              : "This ID is both a chain and its job #1. Choose one:"}
          </p>
        </Show>
        <Show when={options().length > 0}>
          <Listbox<FindOption>
            ref={(element: HTMLUListElement) => {
              results = element;
            }}
            class={["flex flex-col gap-1", { "mt-3": choices().length === 0 }]}
            aria-label={choices().length > 0 ? "Matching items" : "Matching types"}
            options={options()}
            optionValue="href"
            optionTextValue="href"
            autoFocus={choices().length > 0 ? "first" : false}
            onKeyDown={(event: KeyboardEvent) => {
              const first = results?.querySelector("[role=option]");
              if (event.key === "ArrowUp" && document.activeElement === first) input?.focus();
            }}
            onChange={(selected) => {
              const [href] = selected;
              if (href !== undefined) open(href);
            }}
            renderItem={(item) => (
              <Listbox.Item
                item={item}
                class="flex w-full cursor-pointer items-center gap-2 rounded-xs border border-border px-3 py-2 text-left text-sm outline-none hover:bg-surface-2 data-highlighted:border-accent"
              >
                <OptionLabel option={item.rawValue} />
              </Listbox.Item>
            )}
          />
        </Show>
      </div>
    </Dialog>
  );
};
