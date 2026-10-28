---
"@queuert/dashboard": minor
---

The dashboard is easier to read and shows which version you are running. Body text now uses the system sans-serif font, with monospace kept for headings, labels, type names, IDs and JSON, and the top bar carries the dashboard's version. Auto-refresh and the refresh button are removed: reload the page or navigate to see fresh data.

- Body text uses the system sans-serif font; headings, labels, status pills, type names, IDs and JSON stay monospace
- The top bar shows the `@queuert/dashboard` version next to the logo
- The auto-refresh interval picker is removed, and a stored auto-refresh setting is ignored
- The refresh button and its "last loaded" label are removed from the top bar
- The "List has changed · Show" banner on chain and job lists is removed, since lists no longer refresh in place
- The top bar and page width match the docs site: translucent page-colored background, a brand underline under the active section, and a wider content column
