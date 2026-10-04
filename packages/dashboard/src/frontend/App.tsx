import { useIsRouting, useLocation } from "@solidjs/router";
import { type ParentProps, createEffect, onCleanup } from "solid-js";

import { toLocalPath } from "./base.js";
import { FindDialog, handleFindShortcut } from "./shell/FindDialog.js";
import { TopBar } from "./shell/TopBar.js";
import { recordLocation } from "./state/navigation.js";
import { createAutoRefresh } from "./state/refresh.js";

export const App = (props: ParentProps) => {
  const location = useLocation();
  const isRouting = useIsRouting();

  // The location signal updates before the router pushes the history entry; record once routing
  // settles, so the location is stored under its own entry's depth.
  createEffect(() => {
    const here = toLocalPath(location.pathname) + location.search;
    if (!isRouting()) recordLocation(here);
  });

  createAutoRefresh();

  document.addEventListener("keydown", handleFindShortcut);
  onCleanup(() => {
    document.removeEventListener("keydown", handleFindShortcut);
  });

  return (
    <div class="min-h-screen">
      <TopBar />
      <main class="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">{props.children}</main>
      <FindDialog />
    </div>
  );
};
