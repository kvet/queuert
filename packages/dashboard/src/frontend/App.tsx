import { A, useLocation } from "@solidjs/router";
import { type ParentProps } from "solid-js";
import { basePath } from "./base.js";

export function App(props: ParentProps) {
  const location = useLocation();
  const isActive = (path: string) => {
    const fullPath = basePath + path;
    return path === "/" ? location.pathname === fullPath : location.pathname.startsWith(fullPath);
  };

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
