# Type complexity

Last run 2026-11-15 · commit f6399c38 · load average 6.16 · TS 6, TS 7, tsrs

## Type-check time (ms)

| Scenario                     | TS 6 | TS 7 | tsrs |
| ---------------------------- | ---: | ---: | ---: |
| Linear: 1 type               |  536 |  114 |   66 |
| Linear: 5 types              |  528 |  117 |   68 |
| Linear: 10 types             |  577 |  116 |   68 |
| Linear: 20 types             |  560 |  121 |   68 |
| Linear: 50 types             |  613 |  132 |   71 |
| Linear: 100 types            |  731 |  156 |   78 |
| Branched: 2w x 2d            |  530 |  116 |   68 |
| Branched: 3w x 3d            |  620 |  131 |   71 |
| Branched: 4w x 3d            |  707 |  148 |   76 |
| Branched: 2w x 6d            |  827 |  179 |   84 |
| Blockers: 3 steps            |  560 |  129 |   69 |
| Blockers: 8 steps            |  628 |  152 |   73 |
| Blockers: 15 steps           |  703 |  169 |   79 |
| Blockers: 25 steps           |  875 |  199 |   88 |
| Loop: 5 steps                |  537 |  120 |   68 |
| Loop: 10 steps               |  545 |  125 |   69 |
| Loop: 20 steps               |  544 |  130 |   69 |
| Loop: 50 steps               |  631 |  133 |   73 |
| Merge: 2 x 50                |  713 |  152 |   78 |
| Merge: 5 x 50                |  967 |  209 |   94 |
| Merge: 10 x 50               | 1354 |  308 |  120 |
| Merge: 20 x 50               | 2132 |  564 |  174 |
| Merge: 50 x 50               | 4935 | 1391 |  409 |
| Middleware: 1 on linear-100  |  744 |  152 |   78 |
| Middleware: 2 on linear-100  |  746 |  160 |   77 |
| Middleware: 5 on linear-100  |  742 |  155 |   77 |
| Middleware: 10 on linear-100 |  737 |  157 |   78 |

## Instantiations

| Scenario                     | Job types |    TS 6 |    TS 7 |    tsrs |
| ---------------------------- | --------: | ------: | ------: | ------: |
| Linear: 1 type               |         1 |   24947 |   24865 |   24921 |
| Linear: 5 types              |         5 |   27080 |   26995 |   27003 |
| Linear: 10 types             |        10 |   30020 |   29935 |   29883 |
| Linear: 20 types             |        20 |   35900 |   35815 |   35643 |
| Linear: 50 types             |        50 |   53540 |   53455 |   52923 |
| Linear: 100 types            |       100 |   82940 |   82855 |   81723 |
| Branched: 2w x 2d            |         7 |   28331 |   28255 |   28239 |
| Branched: 3w x 3d            |        40 |   48258 |   48251 |   47839 |
| Branched: 4w x 3d            |        85 |   75527 |   75631 |   74679 |
| Branched: 2w x 6d            |       127 |  100391 |  100495 |   99039 |
| Blockers: 3 steps            |        10 |   35660 |   35593 |   35541 |
| Blockers: 8 steps            |        30 |   60100 |   60078 |   59786 |
| Blockers: 15 steps           |        58 |  100364 |  100405 |   99777 |
| Blockers: 25 steps           |        98 |  170124 |  170255 |  169147 |
| Loop: 5 steps                |         6 |   28037 |   27952 |   27948 |
| Loop: 10 steps               |        11 |   31052 |   30967 |   30903 |
| Loop: 20 steps               |        21 |   37082 |   36997 |   36813 |
| Loop: 50 steps               |        51 |   55172 |   55087 |   54543 |
| Merge: 2 x 50                |       100 |   87706 |   87616 |   86484 |
| Merge: 5 x 50                |       250 |  174713 |  174632 |  171700 |
| Merge: 10 x 50               |       500 |  320958 |  320892 |  314960 |
| Merge: 20 x 50               |      1000 |  613432 |  613396 |  601464 |
| Merge: 50 x 50               |      2500 | 1505148 | 1505202 | 1475270 |
| Middleware: 1 on linear-100  |       100 |   82940 |   82855 |   81723 |
| Middleware: 2 on linear-100  |       100 |   83168 |   83083 |   81951 |
| Middleware: 5 on linear-100  |       100 |   83885 |   83800 |   82668 |
| Middleware: 10 on linear-100 |       100 |   85361 |   85275 |   84143 |
