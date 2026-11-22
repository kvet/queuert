---
"@queuert/dashboard": minor
---

The dashboard frontend runs on Solid 2 with Solid Router 2, and loads its data through TanStack Query, so pages share what they loaded: going back to a list or opening a chain, job or worker seen a moment ago shows the cached data at once and refreshes it in the background instead of flashing a loading state.

- Chain, job and worker lists are virtualized against the page scroll and load the next page as you near the end.
- Every view's data is cached across pages and refetched when it is a few seconds old, when the window regains focus, and after a reschedule or delete.
