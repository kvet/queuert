import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";

import { openSearch } from "./Search.tsx";

export const NotFound = () => (
  <main class="mx-auto max-w-xl px-6 py-24 text-center">
    <Title>Not found · Queuert</Title>
    <p class="text-xs font-mono tracking-wider text-fg-subtle uppercase">404</p>
    <h1 class="mt-2 text-xl font-semibold">This page doesn't exist</h1>
    <p class="mt-3 text-fg-muted">
      Check the address,{" "}
      <button type="button" class="text-accent-fg hover:underline" onClick={openSearch}>
        search the docs
      </button>
      , or go to the{" "}
      <A href="/" class="text-accent-fg hover:underline" end>
        home page
      </A>
      .
    </p>
  </main>
);
