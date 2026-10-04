import { A } from "@solidjs/router";
import { For, Show, createResource } from "solid-js";

import { countByJobTypeNames, listJobTypeNames } from "../api.js";
import { formatCount, formatTotalCount } from "./formatCount.js";

export function JobTypes() {
  const [typeNames] = createResource(listJobTypeNames);

  const [counts] = createResource(
    () => typeNames(),
    async (names) => {
      if (names.length === 0) return [];
      return countByJobTypeNames(names);
    },
  );

  return (
    <div>
      <Show when={!typeNames.loading && typeNames()?.length === 0}>
        <div class="empty">No job types found</div>
      </Show>

      <Show when={counts()}>
        <table class="type-table">
          <thead>
            <tr>
              <th>Type name</th>
              <th>Blocked</th>
              <th>Pending</th>
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
                    <A href={`/jobs?typeName=${encodeURIComponent(entry.typeName)}`}>
                      {entry.typeName}
                    </A>
                  </td>
                  <td>
                    <Show
                      when={entry.blocked.count > 0}
                      fallback={<span class="count-zero">0</span>}
                    >
                      <A
                        href={`/jobs?typeName=${encodeURIComponent(entry.typeName)}&status=blocked`}
                        class="count-link"
                        data-status="blocked"
                      >
                        {formatCount(entry.blocked)}
                      </A>
                    </Show>
                  </td>
                  <td>
                    <Show
                      when={entry.pending.count > 0}
                      fallback={<span class="count-zero">0</span>}
                    >
                      <A
                        href={`/jobs?typeName=${encodeURIComponent(entry.typeName)}&status=pending`}
                        class="count-link"
                        data-status="pending"
                      >
                        {formatCount(entry.pending)}
                      </A>
                    </Show>
                  </td>
                  <td>
                    <Show
                      when={entry.running.count > 0}
                      fallback={<span class="count-zero">0</span>}
                    >
                      <A
                        href={`/jobs?typeName=${encodeURIComponent(entry.typeName)}&status=running`}
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
                        href={`/jobs?typeName=${encodeURIComponent(entry.typeName)}&status=completed`}
                        class="count-link"
                        data-status="completed"
                      >
                        {formatCount(entry.completed)}
                      </A>
                    </Show>
                  </td>
                  <td>
                    {formatTotalCount([
                      entry.blocked,
                      entry.pending,
                      entry.running,
                      entry.completed,
                    ])}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
