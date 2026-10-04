import { useNavigate } from "@solidjs/router";
import { For, Match, Show, Switch, createSignal } from "solid-js";

import {
  type UnknownChain,
  type UnknownJob,
  errorMessage,
  getChainsByIds,
  getJobsByIds,
} from "../api.js";
import { MAX_IDS, parseIdList } from "../domain/ids.js";
import { Dialog, buttonClass } from "../ui/kit.js";
import { StatusPill } from "../ui/StatusPill.js";

const [findOpen, setFindOpen] = createSignal(false);

export const openFind = (): void => {
  setFindOpen(true);
};

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Global ⌘K / Ctrl+K handler; ignored while typing in a field outside the dialog. */
export const handleFindShortcut = (event: KeyboardEvent): void => {
  if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
  const inDialog = event.target instanceof Element && event.target.closest("[data-find-dialog]");
  if (isTypingTarget(event.target) && !inDialog) return;
  event.preventDefault();
  setFindOpen(true);
};

type Choice = { kind: "chain"; chain: UnknownChain } | { kind: "job"; job: UnknownJob };

/**
 * Find by ID. One ID resolves in place: a lone chain or job navigates straight to it, and an ID
 * that is both (a chain and its job #1 share an ID) offers the two. Several IDs go to `/find`.
 */
export const FindDialog = () => {
  const navigate = useNavigate();
  const [text, setText] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [message, setMessage] = createSignal<{ text: string; error: boolean } | null>(null);
  const [choices, setChoices] = createSignal<Choice[]>([]);
  const [active, setActive] = createSignal(0);
  let choiceList: HTMLUListElement | undefined;
  let controller: AbortController | null = null;

  const parsed = () => parseIdList(text());

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

  const submit = async () => {
    const { ids } = parsed();
    if (ids.length === 0) return;
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
      if (found.length === 0) setMessage({ text: "No chain or job with this ID", error: false });
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
    <Dialog open={findOpen()} onClose={close} title="Find chains or jobs by ID" class="mt-[12vh]">
      <div data-find-dialog>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label class="sr-only" for="find-ids">
            Chain or job IDs
          </label>
          <textarea
            id="find-ids"
            autofocus
            rows={2}
            class="w-full resize-y rounded-xs border border-border-strong bg-surface px-3 py-2 font-mono text-sm placeholder:text-fg-subtle"
            placeholder="Paste one or more IDs — separated by commas, spaces or new lines"
            value={text()}
            onInput={(event) => {
              setText(event.currentTarget.value);
              setMessage(null);
              setChoices([]);
            }}
            onKeyDown={(event) => {
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
                            <span class="truncate">{chain().typeName}</span>
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
                            <span class="truncate">{job().typeName}</span>
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
