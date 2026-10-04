import { A } from "@solidjs/router";
import { For, Show, createResource } from "solid-js";

import { countByChainTypeNames, listChainTypeNames } from "../api.js";
import { formatCount, formatTotalCount } from "./formatCount.js";

export function ChainTypes() {
  const [typeNames] = createResource(listChainTypeNames);

  const [counts] = createResource(
    () => typeNames(),
    async (names) => {
      if (names.length === 0) return [];
      return countByChainTypeNames(names);
    },
  );

  return (
    <div>
      <Show when={!typeNames.loading && typeNames()?.length === 0}>
        <div class="empty">No chain types found</div>
      </Show>

      <Show when={counts()}>
        <table class="type-table">
          <thead>
            <tr>
              <th>Type name</th>
              <th>Running</th>
              <th>Completed</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <For each={counts()}>
              {(entry) => (
                <tr>
                  <td>
                    <A href={`/chains?typeName=${encodeURIComponent(entry.typeName)}`}>
                      {entry.typeName}
                    </A>
                  </td>
                  <td>
                    <Show
                      when={entry.running.count > 0}
                      fallback={<span class="count-zero">0</span>}
                    >
                      <A
                        href={`/chains?typeName=${encodeURIComponent(entry.typeName)}&status=running`}
                        class="count-link"
                        data-status="running"
                      >
                        {formatCount(entry.running)}
                      </A>
                    </Show>
                  </td>
                  <td>
                    <Show
                      when={entry.completed.count > 0}
                      fallback={<span class="count-zero">0</span>}
                    >
                      <A
                        href={`/chains?typeName=${encodeURIComponent(entry.typeName)}&status=completed`}
                        class="count-link"
                        data-status="completed"
                      >
                        {formatCount(entry.completed)}
                      </A>
                    </Show>
                  </td>
                  <td>{formatTotalCount([entry.running, entry.completed])}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
