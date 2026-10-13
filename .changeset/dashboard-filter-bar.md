---
"@queuert/dashboard": patch
---

Fix the chain and job list status selector, group the list filters into one filter bar, and restyle the selects.

- Only the selected status is highlighted now; previously every status tab showed the active underline.
- The status selector no longer shows a stray vertical scrollbar.
- The status filter, the chain role select (All / Independent / Used as blocker), and sorting share a single labelled filter bar that sits on one line on wide screens and wraps on narrow ones.
- The type switcher, the sort selects, and the auto-refresh menu share one style, and browsers with customizable selects (`appearance: base-select`) show a matching styled picker; other browsers keep their native picker.
