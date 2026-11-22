import { useIsRouting, useLocation } from "@solidjs/router";
import { type ParentProps, createEffect, onSettled } from "solid-js";

import { toLocalPath } from "./base.ts";
import { FindDialog, handleFindShortcut } from "./shell/FindDialog.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { recordLocation } from "./state/navigation.ts";

export const App = (props: ParentProps) => {
  const location = useLocation();
  const isRouting = useIsRouting();

  createEffect(
    () => (isRouting() ? undefined : toLocalPath(location.pathname) + location.search),
    (here) => {
      if (here !== undefined) recordLocation(here);
    },
  );

  onSettled(() => {
    document.addEventListener("keydown", handleFindShortcut);
    return () => {
      document.removeEventListener("keydown", handleFindShortcut);
    };
  });

  return (
    <div class="min-h-screen">
      <TopBar />
      <main class="mx-auto max-w-360 px-4 pt-8 pb-24 sm:px-6">{props.children}</main>
      <FindDialog />
    </div>
  );
};
