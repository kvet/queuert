---
"@queuert/dashboard": patch
---

The dashboard's type pages now share the lists' status filter, the find dialog also finds types, and type rows are simpler.

- The chain and job type pages have the same status filter as the chain and job lists, with the number of matching types per status; types with nothing in the selected status are hidden. The pages always list types by name; the name filter and sort control are gone, since the find dialog now finds types.
- The Overview's chain and job type lists leave out types with no running chains or no blocked, pending or running jobs.
- Type rows no longer show a total next to the type name.
- The find dialog (`⌘K` / `Ctrl+K`) now also finds chain and job types by name and opens the chosen type's list.
- Type search in the find dialog works like fzf: letters in order, space-separated words in any order, smart case, and best matches first. `Enter` opens the top matching type when the text is no chain or job ID.
- Completed chains and jobs are now shown in gray instead of green, so blocked, pending and running work stands out.
