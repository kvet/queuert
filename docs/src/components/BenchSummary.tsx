import { A } from "@solidjs/router";
import { For, type JSX } from "solid-js";

import { ArrowRightIcon } from "./icons.tsx";

type BenchTile = {
  suite: string;
  href: string;
  value: string;
  unit: string;
  caption: JSX.Element;
  detail: JSX.Element;
};

export const BenchSummary = (props: { tiles: BenchTile[] }) => (
  <ul class="row-list my-6 grid gap-4 sm:grid-cols-2">
    <For each={props.tiles}>
      {(tile) => (
        <li class="relative flex flex-col gap-1 rounded-xs border border-border p-4 hover:border-border-strong">
          <A
            href={tile.href}
            class="unstyled flex items-center justify-between gap-2 text-xs font-semibold font-mono tracking-wider text-fg-muted uppercase no-underline after:absolute after:inset-0 hover:text-accent-fg"
          >
            {tile.suite}
            <ArrowRightIcon size={13} />
          </A>
          <div class="mt-1 flex items-baseline gap-1.5">
            <span class="text-2xl font-semibold text-fg tabular-nums">{tile.value}</span>
            <span class="text-sm text-fg-muted">{tile.unit}</span>
          </div>
          <div class="text-sm leading-6 text-fg">{tile.caption}</div>
          <div class="text-[13px] leading-5 text-fg-subtle">{tile.detail}</div>
        </li>
      )}
    </For>
  </ul>
);
