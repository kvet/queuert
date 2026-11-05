---
"@queuert/dashboard": minor
---

Removed auto-refresh, the refresh button and the "List has changed" banner: reload the page or navigate to see fresh data. The dashboard is also easier to read and shows which version you are running: body text uses the system sans-serif font, with monospace kept for headings, labels, type names, IDs and JSON, and the top bar carries the dashboard's version.

- Body text uses the system sans-serif font; headings, labels, status pills, type names, IDs and JSON stay monospace
- The top bar shows the `@queuert/dashboard` version next to the logo
- The auto-refresh interval picker is removed, and a stored auto-refresh setting is ignored
- The refresh button and its "last loaded" label are removed from the top bar
- The "List has changed · Show" banner on chain and job lists is removed, since lists no longer refresh in place
- The top bar and page width match the docs site: translucent page-colored background, a brand underline under the active section, and a wider content column
