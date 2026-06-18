---
"@queuert/dashboard": minor
---

Dashboard UX improvements: infinite scroll, real links on cards, and smart back navigation.

- List views (chains, jobs, chain detail jobs) now load the next page automatically as you scroll, with the "Load more" button retained as a manual fallback. Page size increased from 25 to 100. The chain detail view pages through its jobs via a new `GET /api/chains/{chainId}/jobs` endpoint and a `nextCursor` on the chain detail response. The chain detail "Blocking" list is likewise paged 100 at a time with cursor/limit support.
- Chain and job cards are now real `<a>` links, so right-click, middle-click, or ⌘/Ctrl-click opens in a new tab. Nested filter buttons and chain links inside each card stay individually clickable, and cards are keyboard-focusable.
- The back link now pops browser history to return you to where you came from (preserving filters), falling back to the relevant list when there is no in-app history (deep link, reload, or new tab).
