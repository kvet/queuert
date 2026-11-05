import { Box } from "@queuert/ui/components";
import { For, Show } from "solid-js";

import { type SchemaDialect, schemaIndexes, schemaTables } from "./schema.ts";

const TableTitle = (props: { name: string }) => (
  <span class="font-mono tracking-normal normal-case">{`{prefix}${props.name}`}</span>
);

const Label = (props: { children: string }) => (
  <span class="ml-1.5 align-middle text-[10px] font-medium tracking-wide text-fg-subtle uppercase">
    {props.children}
  </span>
);

/** One dense line per column: name, type, description. Stacks the description below on mobile. */
const rowClass =
  "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 px-4 py-1.5 sm:grid-cols-[12rem_12.5rem_minmax(0,1fr)] sm:gap-x-4";

/** Every table an adapter's migrations create, one box per table with one line per column. */
export const SchemaTables = (props: { dialect: SchemaDialect }) => (
  <For each={schemaTables[props.dialect]}>
    {(table) => (
      <>
        <p>
          <code>{table.name}</code> — {table.purpose}
        </p>
        <Box title={<TableTitle name={table.name} />} class="my-4" bodyClass="">
          <ul class="row-list m-0 divide-y divide-border">
            <For each={table.columns}>
              {(column) => (
                <li class={rowClass}>
                  <span class="font-mono text-[13px] break-all text-fg">
                    {column.name}
                    <Show when={column.primaryKey}>
                      <Label>pk</Label>
                    </Show>
                    <Show when={column.head}>
                      <Label>head rows only</Label>
                    </Show>
                  </span>
                  <span class="font-mono text-xs text-fg-subtle">{column.type}</span>
                  <span class="col-span-2 text-[13px] leading-5 text-fg-muted sm:col-span-1">
                    {column.description}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Box>
      </>
    )}
  </For>
);

/** The indexes the migrations create, grouped by table: name and purpose, definition below. */
export const SchemaIndexes = (props: { dialect: SchemaDialect }) => (
  <For each={["job", "job_blocker", "worker"]}>
    {(table) => (
      <Box title={<TableTitle name={table} />} class="my-4" bodyClass="">
        <ul class="row-list m-0 divide-y divide-border">
          <For each={schemaIndexes[props.dialect].filter((index) => index.table === table)}>
            {(index) => (
              <li class="grid gap-x-4 gap-y-0.5 px-4 py-1.5 sm:grid-cols-[13rem_minmax(0,1fr)]">
                <span class="font-mono text-[13px] break-all text-fg">{index.name}</span>
                <span class="text-[13px] leading-5 text-fg-muted">{index.purpose}</span>
                <code class="bg-transparent p-0 font-mono text-xs wrap-break-word text-fg-subtle sm:col-start-2">
                  {index.definition}
                </code>
              </li>
            )}
          </For>
        </ul>
      </Box>
    )}
  </For>
);
