import { A, useLocation } from "@solidjs/router";
import { type ParentProps, createEffect } from "solid-js";

import { basePath } from "./base.js";
import { setCameFromApp } from "./navigation.js";

export function App(props: ParentProps) {
  const location = useLocation();
  const isActive = (path: string) => {
    const fullPath = basePath + path;
    return path === "/" ? location.pathname === fullPath : location.pathname.startsWith(fullPath);
  };

  // The first run is the initial (possibly deep-linked) load; any later change to the URL
  // is an in-app navigation, after which a history-back is safe.
  createEffect((prev: string | undefined) => {
    const here = location.pathname + location.search;
    if (prev !== undefined && prev !== here) setCameFromApp(true);
    return here;
  }, undefined);

  return (
    <div class="layout">
      <nav class="nav">
        <span class="nav-title">Queuert</span>
        <A href="/" aria-current={isActive("/") && !isActive("/jobs") ? "page" : undefined}>
          Chains
        </A>
        <A href="/jobs" aria-current={isActive("/jobs") ? "page" : undefined}>
          Jobs
        </A>
      </nav>
      {props.children}
    </div>
  );
}
