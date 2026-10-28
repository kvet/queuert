import { StatusPill } from "@queuert/ui/components";
import { useNavigate } from "@solidjs/router";
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";

import {
  type UnknownChain,
  type UnknownJob,
  errorMessage,
  getChainsByIds,
  getJobsByIds,
  listChainTypeNames,
  listJobTypeNames,
} from "../api.js";
import { MAX_IDS, parseIdList } from "../domain/ids.js";
import { matchTypeNames } from "../domain/typeMatch.js";
import { createLoader } from "../state/createLoader.js";
import { Dialog, buttonClass } from "../ui/kit.js";

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

type Choice = { kind: "chain"; chain: UnknownChain } | { kind: "job"; job: UnknownJob };

type TypeSuggestion = { kind: "chain" | "job"; typeName: string };

const TYPE_SUGGESTIONS = 5;

export const FindDialog = () => {
  const navigate = useNavigate();
  const [text, setText] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [message, setMessage] = createSignal<{ text: string; error: boolean } | null>(null);
  const [choices, setChoices] = createSignal<Choice[]>([]);
  const [active, setActive] = createSignal(0);
  let choiceList: HTMLUListElement | undefined;
  let suggestionList: HTMLUListElement | undefined;
  let input: HTMLTextAreaElement | undefined;
  let controller: AbortController | null = null;

  const parsed = () => parseIdList(text());

  const typeNames = createLoader(
    () => findOpen(),
    async (_, signal) => {
      const [chains, jobs] = await Promise.all([
        listChainTypeNames({ signal }),
        listJobTypeNames({ signal }),
      ]);
      return { chains, jobs };
    },
  );
  const suggestions = createMemo((): TypeSuggestion[] => {
    const names = typeNames.data();
    if (!names || choices().length > 0 || /[,\n]/.test(text())) return [];
    return [
      ...matchTypeNames(names.chains, text(), TYPE_SUGGESTIONS).map((typeName) => ({
        kind: "chain" as const,
        typeName,
      })),
      ...matchTypeNames(names.jobs, text(), TYPE_SUGGESTIONS).map((typeName) => ({
        kind: "job" as const,
        typeName,
      })),
    ];
  });
  const suggestionButtons = () => [...(suggestionList?.querySelectorAll("button") ?? [])];

  const close = () => {
    setFindOpen(false);
    controller?.abort();
    setText("");
    setMessage(null);
    setChoices([]);
    setSearching(false);
  };

  const go = (choice: Choice) => {
    close();
    navigate(choice.kind === "chain" ? `/chains/${choice.chain.id}` : `/jobs/${choice.job.id}`);
  };

  const goToType = (suggestion: TypeSuggestion) => {
    close();
    navigate(
      `${suggestion.kind === "chain" ? "/chains" : "/jobs"}?typeName=${encodeURIComponent(suggestion.typeName)}`,
    );
  };

  const submit = async () => {
    const { ids } = parsed();
    if (ids.length === 0) return;
    if (ids.length > 1 && suggestions().length > 0) {
      goToType(suggestions()[0]);
      return;
    }
    if (ids.length > 1) {
      close();
      navigate(`/find?ids=${encodeURIComponent(ids.join(","))}`);
      return;
    }
    controller?.abort();
    const own = new AbortController();
    controller = own;
    setSearching(true);
    setMessage(null);
    setChoices([]);
    try {
      const [chains, jobs] = await Promise.all([
        getChainsByIds(ids, { signal: own.signal }),
        getJobsByIds(ids, { signal: own.signal }),
      ]);
      if (own.signal.aborted) return;
      const found: Choice[] = [
        ...chains.items.map((chain) => ({ kind: "chain" as const, chain })),
        ...jobs.items.map((job) => ({ kind: "job" as const, job })),
      ];
      const topSuggestion = suggestions()[0];
      if (found.length === 0 && topSuggestion) goToType(topSuggestion);
      else if (found.length === 0)
        setMessage({ text: "No chain or job with this ID", error: false });
      else if (found.length === 1) go(found[0]);
      else {
        setChoices(found);
        setActive(0);
        queueMicrotask(() => choiceList?.querySelector("button")?.focus());
      }
    } catch (error) {
      if (own.signal.aborted) return;
      setMessage({ text: `Lookup failed: ${errorMessage(error)}`, error: true });
    } finally {
      if (controller === own) setSearching(false);
    }
  };

  const focusChoice = (index: number) => {
    setActive(index);
    choiceList?.querySelectorAll("button")[index]?.focus();
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
            Chain or job IDs, or a type name
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
              if (event.key === "ArrowDown" && suggestions().length > 0) {
                event.preventDefault();
                suggestionButtons()[0]?.focus();
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
              class={`mt-3 text-sm ${message().error ? "text-error-fg" : "text-fg-muted"}`}
              role="status"
            >
              {message().text}
            </p>
          )}
        </Show>

        <Show when={suggestions().length > 0}>
          <ul
            ref={(element) => {
              suggestionList = element;
            }}
            class="mt-3 flex flex-col gap-1"
            aria-label="Matching types"
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const buttons = suggestionButtons();
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              if (event.key === "ArrowUp" && index <= 0) input?.focus();
              else
                buttons[(index + (event.key === "ArrowDown" ? 1 : -1)) % buttons.length]?.focus();
            }}
          >
            <For each={suggestions()}>
              {(suggestion) => (
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-xs border border-border px-3 py-2 text-left text-sm hover:bg-surface-2 focus:border-accent focus:outline-none"
                    onClick={() => {
                      goToType(suggestion);
                    }}
                  >
                    <span class="shrink-0 text-fg-muted">
                      {suggestion.kind === "chain" ? "Chain type" : "Job type"}
                    </span>
                    <span class="text-fg-subtle">·</span>
                    <span class="truncate font-mono font-medium">{suggestion.typeName}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={choices().length > 0}>
          <p class="mt-3 mb-2 text-xs text-fg-muted">
            This ID is both a chain and its job #1. Choose one:
          </p>
          <ul
            ref={(element) => {
              choiceList = element;
            }}
            class="flex flex-col gap-1"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusChoice((active() + 1) % choices().length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                focusChoice((active() - 1 + choices().length) % choices().length);
              }
            }}
          >
            <For each={choices()}>
              {(choice, index) => (
                <li>
                  <button
                    type="button"
                    class={`flex w-full items-center gap-2 rounded-xs border px-3 py-2 text-left text-sm hover:bg-surface-2 ${
                      active() === index() ? "border-accent" : "border-border"
                    }`}
                    onFocus={() => setActive(index())}
                    onClick={() => {
                      go(choice);
                    }}
                  >
                    <Switch>
                      <Match when={choice.kind === "chain" && choice.chain}>
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
                      <Match when={choice.kind === "job" && choice.job}>
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
                    </Switch>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Dialog>
  );
};
