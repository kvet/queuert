import { useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, createSignal } from "solid-js";

import { getChainsByIds, getJobsByIds } from "../api.js";
import { MAX_IDS, parseIdList, shortId } from "../domain/ids.js";
import { ChainRow } from "../rows/ChainRow.js";
import { JobRow } from "../rows/JobRow.js";
import { createLoader } from "../state/createLoader.js";
import { useRefresh } from "../state/refresh.js";
import { CloseIcon } from "../ui/icons.js";
import { Card, EmptyState, ErrorState, SkeletonRows } from "../ui/kit.js";

const IdChipsInput = (props: {
  ids: string[];
  onChange: (ids: string[]) => void;
  overLimit: boolean;
}) => {
  const [draft, setDraft] = createSignal("");
  let input!: HTMLInputElement;

  const add = (text: string) => {
    const { ids } = parseIdList([...props.ids, text].join(","));
    props.onChange(ids);
    setDraft("");
  };

  return (
    <div>
      <div
        class="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xs border border-border-strong bg-surface px-2 py-1.5"
        onClick={() => {
          input.focus();
        }}
      >
        <For each={props.ids}>
          {(id) => (
            <span
              class="inline-flex max-w-full items-center gap-1 rounded-xs bg-surface-2 py-0.5 pr-0.5 pl-1.5 font-mono text-xs"
              title={id}
            >
              <span class="truncate">{shortId(id)}</span>
              <button
                type="button"
                class="inline-flex size-4 items-center justify-center rounded-xs text-fg-subtle hover:bg-surface hover:text-fg"
                aria-label={`Remove ${id}`}
                onClick={() => {
                  props.onChange(props.ids.filter((other) => other !== id));
                }}
              >
                <CloseIcon size={10} />
              </button>
            </span>
          )}
        </For>
        <input
          ref={(el) => {
            input = el;
          }}
          autofocus={props.ids.length === 0}
          class="min-w-40 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-fg-subtle"
          placeholder={props.ids.length === 0 ? "Paste or type IDs" : "Add IDs"}
          aria-label="IDs to find"
          value={draft()}
          onInput={(event) => {
            const value = event.currentTarget.value;
            if (/[\s,]/.test(value)) add(value);
            else setDraft(value);
          }}
          onPaste={(event) => {
            const text = event.clipboardData?.getData("text");
            if (!text) return;
            event.preventDefault();
            add(draft() + text);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft()) {
              event.preventDefault();
              add(draft());
            } else if (event.key === "Backspace" && !draft() && props.ids.length > 0) {
              props.onChange(props.ids.slice(0, -1));
            }
          }}
        />
      </div>
      <Show when={props.overLimit}>
        <p class="mt-1 text-xs text-error-fg">Max {MAX_IDS} IDs</p>
      </Show>
    </div>
  );
};

export const Find = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [editedOverLimit, setOverLimit] = createSignal(false);
  const parsedIds = () => parseIdList((searchParams.ids ?? "") as string);
  const ids = () => parsedIds().ids;
  // A deep link can carry more IDs than are looked up; say so instead of dropping them silently.
  const overLimit = () => editedOverLimit() || parsedIds().overLimit;

  const setIds = (next: string[]) => {
    const parsed = parseIdList(next.join(","));
    setOverLimit(next.length > MAX_IDS || parsed.overLimit);
    setSearchParams(
      { ids: parsed.ids.length > 0 ? parsed.ids.join(",") : undefined },
      { replace: true },
    );
  };

  const results = createLoader(
    () => (ids().length > 0 ? ids().join(",") : null),
    async (joined, signal) => {
      const list = joined.split(",");
      const [chains, jobs] = await Promise.all([
        getChainsByIds(list, { signal }),
        getJobsByIds(list, { signal }),
      ]);
      return { chains: chains.items, jobs: jobs.items };
    },
  );
  useRefresh(results.refetch);

  const notFound = () => {
    const data = results.data();
    if (!data) return [];
    const found = new Set([
      ...data.chains.map((chain) => chain.id),
      ...data.jobs.map((job) => job.id),
    ]);
    return ids().filter((id) => !found.has(id));
  };

  return (
    <div>
      <div class="mb-5">
        <h1 class="text-base font-semibold">Find by ID</h1>
      </div>
      <div class="mb-4">
        <IdChipsInput ids={ids()} onChange={setIds} overLimit={overLimit()} />
      </div>
      <Switch>
        <Match when={ids().length === 0}>
          <EmptyState title="Paste chain or job IDs above to look them up." />
        </Match>
        <Match when={results.error()}>
          <ErrorState thing="the results" error={results.error()} onRetry={results.retry} />
        </Match>
        <Match when={results.loading() || !results.data()}>
          <div class="rounded-xs border border-border">
            <SkeletonRows />
          </div>
        </Match>
        <Match when={results.data()}>
          {(data) => (
            <div class="flex flex-col gap-6">
              <p class="text-sm text-fg-muted">
                {ids().length} IDs · {data().chains.length} chains · {data().jobs.length} jobs ·{" "}
                {notFound().length} not found
              </p>
              <Show when={data().chains.length > 0}>
                <Card title="Chains" bodyClass="">
                  <ul class="divide-y divide-border">
                    <For each={data().chains}>
                      {(chain) => <ChainRow chain={chain} sortKey="createdAt" showType />}
                    </For>
                  </ul>
                </Card>
              </Show>
              <Show when={data().jobs.length > 0}>
                <Card title="Jobs" bodyClass="">
                  <ul class="divide-y divide-border">
                    <For each={data().jobs}>
                      {(job) => <JobRow job={job} sortKey="createdAt" showType />}
                    </For>
                  </ul>
                </Card>
              </Show>
              <Show when={notFound().length > 0}>
                <Card title="Not found">
                  <ul class="flex flex-col gap-1 font-mono text-xs text-fg-muted">
                    <For each={notFound()}>{(id) => <li class="break-all">{id}</li>}</For>
                  </ul>
                </Card>
              </Show>
            </div>
          )}
        </Match>
      </Switch>
    </div>
  );
};
