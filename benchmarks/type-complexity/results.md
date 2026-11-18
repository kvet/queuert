# Type complexity

Last run 2026-11-18 · commit 2748cec8 · load average 3.79 · TS 6, TS 7, tsrs

## Type-check time (ms)

| Scenario                     | TS 6 | TS 7 | tsrs |
| ---------------------------- | ---: | ---: | ---: |
| Linear: 1 type               |  350 |   79 |   47 |
| Linear: 5 types              |  350 |   84 |   47 |
| Linear: 10 types             |  370 |   81 |   46 |
| Linear: 20 types             |  383 |   85 |   47 |
| Linear: 50 types             |  384 |   94 |   49 |
| Linear: 100 types            |  482 |  108 |   53 |
| Branched: 2w x 2d            |  358 |   78 |   47 |
| Branched: 3w x 3d            |  444 |   91 |   50 |
| Branched: 4w x 3d            |  479 |  101 |   52 |
| Branched: 2w x 6d            |  496 |  113 |   58 |
| Blockers: 3 steps            |  345 |   84 |   47 |
| Blockers: 8 steps            |  399 |   95 |   50 |
| Blockers: 15 steps           |  498 |  110 |   54 |
| Blockers: 25 steps           |  575 |  134 |   59 |
| Loop: 5 steps                |  356 |   79 |   47 |
| Loop: 10 steps               |  348 |   81 |   47 |
| Loop: 20 steps               |  366 |   84 |   48 |
| Loop: 50 steps               |  411 |   91 |   50 |
| Merge: 2 x 50                |  466 |  105 |   54 |
| Merge: 5 x 50                |  623 |  142 |   63 |
| Merge: 10 x 50               |  887 |  210 |   80 |
| Merge: 20 x 50               | 1290 |  349 |  117 |
| Merge: 50 x 50               | 2848 |  888 |  254 |
| Middleware: 1 on linear-100  |  457 |  106 |   53 |
| Middleware: 2 on linear-100  |  460 |  104 |   54 |
| Middleware: 5 on linear-100  |  460 |  107 |   54 |
| Middleware: 10 on linear-100 |  458 |  106 |   53 |

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
