import { A, useNavigate } from "@solidjs/router";

import { cameFromApp } from "../navigation.js";

/**
 * "← Back" control. On a plain left click it pops history (`navigate(-1)`), returning to
 * the exact previous view — restoring its filters, which live in the URL query. When there
 * is no in-app history to pop (deep link, reload, or a card opened in a new tab) it behaves
 * as a real link to `fallback`, which also lets right-click / ⌘-click open the list directly.
 */
export function BackLink(props: { fallback: string }) {
  const navigate = useNavigate();
  return (
    <A
      href={props.fallback}
      class="back-link"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (!cameFromApp()) return;
        e.preventDefault();
        navigate(-1);
      }}
    >
      &larr; Back
    </A>
  );
}
