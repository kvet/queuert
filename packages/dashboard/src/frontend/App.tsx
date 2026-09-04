import { A, useLocation } from "@solidjs/router";
import { type ParentProps, createEffect } from "solid-js";

import { basePath } from "./base.js";
import { setCameFromApp } from "./navigation.js";

export function App(props: ParentProps) {
  const location = useLocation();
  const isActive = (path: string) => {
    const fullPath = basePath + path;
    return location.pathname === fullPath;
  };
  const isActivePrefix = (path: string) => {
    const fullPath = basePath + path;
    return location.pathname === fullPath || location.pathname.startsWith(fullPath + "/");
  };

  const chainsActive = () =>
    isActive("/chains/types") || isActive("/chains") || isActivePrefix("/chains");
  const jobsActive = () => isActive("/jobs/types") || isActive("/jobs") || isActivePrefix("/jobs");

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
        <A href="/" class="nav-title">
          Queuert
        </A>
        <a
          href="https://kvet.github.io/queuert/"
          target="_blank"
          rel="noopener"
          class="nav-docs"
          title="Documentation"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2 2.5A1.5 1.5 0 0 1 3.5 1h5.586a1 1 0 0 1 .707.293l3.414 3.414a1 1 0 0 1 .293.707V13.5A1.5 1.5 0 0 1 12 15H3.5A1.5 1.5 0 0 1 2 13.5v-11Z"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <path
              d="M5 7h6M5 9.5h6M5 12h4"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </a>
        <span class="nav-group" data-active={chainsActive() || undefined}>
          <span class="nav-group-label">Chains</span>
          <A href="/chains/types" aria-current={isActive("/chains/types") ? "page" : undefined}>
            Types
          </A>
          <A
            href="/chains"
            aria-current={
              isActive("/chains") || (isActivePrefix("/chains") && !isActive("/chains/types"))
                ? "page"
                : undefined
            }
          >
            List
          </A>
        </span>
        <span class="nav-group" data-active={jobsActive() || undefined}>
          <span class="nav-group-label">Jobs</span>
          <A href="/jobs/types" aria-current={isActive("/jobs/types") ? "page" : undefined}>
            Types
          </A>
          <A
            href="/jobs"
            aria-current={
              isActive("/jobs") || (isActivePrefix("/jobs") && !isActive("/jobs/types"))
                ? "page"
                : undefined
            }
          >
            List
          </A>
        </span>
      </nav>
      {props.children}
    </div>
  );
}
