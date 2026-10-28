import { SearchIcon } from "@queuert/ui/components";
import { useNavigate } from "@solidjs/router";
import type MiniSearch from "minisearch";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";

import { type SearchEntry } from "../../plugins/search-index.ts";
import { fetchSearchEntries } from "./searchEntries.ts";

const [open, setOpen] = createSignal(false);
const [requested, setRequested] = createSignal(false);

export const openSearch = (): void => {
  setRequested(true);
  setOpen(true);
};

const loadIndex = async (): Promise<MiniSearch<SearchEntry>> => {
  const [{ default: MiniSearchClass }, entries] = await Promise.all([
    import("minisearch"),
    fetchSearchEntries(`${import.meta.env.BASE_URL}search.json`),
  ]);
  const index = new MiniSearchClass<SearchEntry>({
    fields: ["title", "heading", "text"],
    storeFields: ["title", "heading", "section", "href", "text"],
    searchOptions: {
      boost: { title: 5, heading: 3 },
      prefix: true,
      fuzzy: 0.15,
      combineWith: "AND",
    },
  });
  index.addAll(entries);
  return index;
};

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const highlightTerms = (text: string, terms: string[]): string => {
  if (terms.length === 0) return escapeHtml(text);
  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return text
    .split(pattern)
    .map((part, index) => (index % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join("");
};

const snippet = (text: string, terms: string[]): string => {
  const lower = text.toLowerCase();
  const position = Math.min(
    ...terms.map((term) => lower.indexOf(term.toLowerCase())).filter((index) => index >= 0),
  );
  const start = Number.isFinite(position) ? Math.max(0, position - 60) : 0;
  const excerpt = text.slice(start, start + 180);
  return `${start > 0 ? "…" : ""}${highlightTerms(excerpt, terms)}${start + 180 < text.length ? "…" : ""}`;
};

type Hit = SearchEntry & { terms: string[] };

export const SearchDialog = () => {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [index, { refetch }] = createResource(requested, loadIndex);
  const readyIndex = () => (index.state === "ready" ? index() : undefined);
  let dialog!: HTMLDialogElement;
  let input!: HTMLInputElement;
  let list!: HTMLUListElement;

  const hits = createMemo((): Hit[] => {
    const search = readyIndex();
    const text = query().trim();
    if (!search || text === "") return [];
    const results = search.search(text);
    const fallback = results.length > 0 ? results : search.search(text, { combineWith: "OR" });
    return fallback.slice(0, 24).map((result) => ({
      ...(result as unknown as SearchEntry),
      terms: result.terms,
    }));
  });

  const grouped = createMemo(() => {
    const groups = new Map<
      string,
      { title: string; section: string; hits: (Hit & { position: number })[] }
    >();
    hits().forEach((hit, position) => {
      const key = hit.href.split("#")[0];
      const group = groups.get(key) ?? { title: hit.title, section: hit.section, hits: [] };
      group.hits.push({ ...hit, position });
      groups.set(key, group);
    });
    return [...groups.values()];
  });

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    setOpen(false);
    navigate(hit.href);
  };

  createEffect(() => {
    if (open()) {
      if (!dialog.open) dialog.showModal();
      input.focus();
      input.select();
    } else if (dialog.open) {
      dialog.close();
    }
  });

  createEffect(
    on(open, (isOpen) => {
      if (isOpen && index.state === "errored") void refetch();
    }),
  );

  createEffect(() => {
    query();
    setSelected(0);
  });

  createEffect(() => {
    list?.querySelector(`[data-position="${selected()}"]`)?.scrollIntoView({ block: "nearest" });
  });

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, [contenteditable]") !== null;
      if (
        (event.key === "k" && (event.metaKey || event.ctrlKey)) ||
        (event.key === "/" && !typing)
      ) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
    });
  });

  return (
    <dialog
      ref={(element) => {
        dialog = element;
      }}
      class="search-dialog m-0 mx-auto mt-[12vh] w-[min(640px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xs border border-border-strong bg-surface p-0 text-fg shadow-2xl"
      aria-label="Search documentation"
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === dialog) setOpen(false);
      }}
    >
      <div class="flex items-center gap-2.5 border-b border-border px-4">
        <SearchIcon size={15} class="shrink-0 text-fg-subtle" />
        <input
          ref={(element) => {
            input = element;
          }}
          type="search"
          placeholder="Search docs, guides and API…"
          class="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:hidden"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((value) => Math.min(value + 1, hits().length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              go(hits()[selected()]);
            }
          }}
          aria-controls="search-results"
          aria-activedescendant={hits().length > 0 ? `search-hit-${selected()}` : undefined}
        />
        <kbd class="rounded-xs border border-border px-1.5 text-[11px] text-fg-subtle">esc</kbd>
      </div>
      <div class="max-h-[min(60vh,520px)] overflow-y-auto">
        <Show
          when={index.state !== "errored"}
          fallback={
            <p class="px-4 py-8 text-center text-xs text-fg-subtle" role="status">
              Search unavailable: the search index couldn't be loaded. Close and reopen search to
              try again.
            </p>
          }
        >
          <Show
            when={query().trim() !== ""}
            fallback={
              <p class="px-4 py-8 text-center text-xs text-fg-subtle">
                Search guides, integrations and every exported symbol.
              </p>
            }
          >
            <Show
              when={!index.loading}
              fallback={<p class="px-4 py-8 text-center text-xs text-fg-subtle">Loading index…</p>}
            >
              <Show
                when={hits().length > 0}
                fallback={
                  <p class="px-4 py-8 text-center text-xs text-fg-subtle">
                    No results for “{query().trim()}”.
                  </p>
                }
              >
                <ul
                  ref={(element) => {
                    list = element;
                  }}
                  id="search-results"
                  role="listbox"
                  class="py-2"
                >
                  <For each={grouped()}>
                    {(group) => (
                      <li class="px-2 pb-2">
                        <p class="px-2 pt-2 pb-1 text-[11px] font-mono tracking-wider text-fg-subtle uppercase">
                          {group.section}
                        </p>
                        <ul>
                          <For each={group.hits}>
                            {(hit) => (
                              <li
                                id={`search-hit-${hit.position}`}
                                role="option"
                                data-position={hit.position}
                                aria-selected={selected() === hit.position}
                                class="cursor-pointer rounded-xs px-2 py-2 aria-selected:bg-surface-2"
                                onMouseMove={() => setSelected(hit.position)}
                                onClick={() => {
                                  go(hit);
                                }}
                              >
                                <p class="truncate text-[13px] font-medium">
                                  {hit.title}
                                  <Show when={hit.heading}>
                                    <span class="text-fg-subtle"> › </span>
                                    <span>{hit.heading}</span>
                                  </Show>
                                </p>
                                <p
                                  class="search-snippet mt-0.5 line-clamp-2 text-xs leading-5 text-fg-muted"
                                  innerHTML={snippet(hit.text, hit.terms)}
                                />
                              </li>
                            )}
                          </For>
                        </ul>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
      <div class="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-fg-subtle">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> to navigate
        </span>
        <span>
          <kbd>↵</kbd> to open
        </span>
      </div>
    </dialog>
  );
};
