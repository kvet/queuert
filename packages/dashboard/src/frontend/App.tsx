import { useIsRouting, useLocation } from "@solidjs/router";
import { type ParentProps, createEffect, onCleanup } from "solid-js";

import { toLocalPath } from "./base.js";
import { FindDialog, handleFindShortcut } from "./shell/FindDialog.js";
import { TopBar } from "./shell/TopBar.js";
import { recordLocation } from "./state/navigation.js";

export const App = (props: ParentProps) => {
  const location = useLocation();
  const isRouting = useIsRouting();

  createEffect(() => {
    const here = toLocalPath(location.pathname) + location.search;
    if (!isRouting()) recordLocation(here);
  });

  document.addEventListener("keydown", handleFindShortcut);
  onCleanup(() => {
    document.removeEventListener("keydown", handleFindShortcut);
  });

  return (
    <div class="min-h-screen">
      <TopBar />
      <main class="mx-auto max-w-360 px-4 pt-8 pb-24 sm:px-6">{props.children}</main>
      <FindDialog />
    </div>
  );
};
