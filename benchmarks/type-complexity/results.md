# Type complexity

Last run 2026-11-22 · commit e92d4c8b · load average 2.43 · TS 6, TS 7, tsrs

## Type-check time (ms)

| Scenario                     | TS 6 | TS 7 | tsrs |
| ---------------------------- | ---: | ---: | ---: |
| Linear: 1 type               |  334 |   81 |   49 |
| Linear: 5 types              |  338 |   83 |   49 |
| Linear: 10 types             |  351 |   84 |   49 |
| Linear: 20 types             |  375 |   84 |   48 |
| Linear: 50 types             |  393 |   97 |   51 |
| Linear: 100 types            |  482 |  114 |   55 |
| Branched: 2w x 2d            |  344 |   83 |   47 |
| Branched: 3w x 3d            |  394 |   96 |   51 |
| Branched: 4w x 3d            |  452 |  109 |   54 |
| Branched: 2w x 6d            |  518 |  128 |   58 |
| Blockers: 3 steps            |  365 |   86 |   49 |
| Blockers: 8 steps            |  399 |   95 |   53 |
| Blockers: 15 steps           |  453 |  112 |   55 |
| Blockers: 25 steps           |  548 |  140 |   63 |
| Loop: 5 steps                |  341 |   82 |   48 |
| Loop: 10 steps               |  353 |   83 |   51 |
| Loop: 20 steps               |  359 |   87 |   50 |
| Loop: 50 steps               |  400 |   99 |   56 |
| Merge: 2 x 50                |  463 |  111 |   62 |
| Merge: 5 x 50                |  610 |  153 |   69 |
| Merge: 10 x 50               |  845 |  222 |   85 |
| Merge: 20 x 50               | 1327 |  377 |  124 |
| Merge: 50 x 50               | 3101 |  988 |  284 |
| Middleware: 1 on linear-100  |  476 |  115 |   57 |
| Middleware: 2 on linear-100  |  486 |  115 |   57 |
| Middleware: 5 on linear-100  |  501 |  113 |   57 |
| Middleware: 10 on linear-100 |  490 |  116 |   63 |

## Instantiations

| Scenario                     | Job types |    TS 6 |    TS 7 |    tsrs |
| ---------------------------- | --------: | ------: | ------: | ------: |
| Linear: 1 type               |         1 |   24735 |   24713 |   24829 |
| Linear: 5 types              |         5 |   27209 |   27187 |   27260 |
| Linear: 10 types             |        10 |   30094 |   30072 |   30090 |
| Linear: 20 types             |        20 |   35864 |   35842 |   35750 |
| Linear: 50 types             |        50 |   53174 |   53152 |   52730 |
| Linear: 100 types            |       100 |   82024 |   82002 |   81030 |
| Branched: 2w x 2d            |         7 |   28390 |   28380 |   28431 |
| Branched: 3w x 3d            |        40 |   47586 |   47668 |   47356 |
| Branched: 4w x 3d            |        85 |   73768 |   73998 |   73191 |
| Branched: 2w x 6d            |       127 |   98170 |   98400 |   97131 |
| Blockers: 3 steps            |        10 |   35644 |   35646 |   35664 |
| Blockers: 8 steps            |        30 |   59599 |   59661 |   59459 |
| Blockers: 15 steps           |        58 |   99184 |   99330 |   98820 |
| Blockers: 25 steps           |        98 |  167974 |  168240 |  167290 |
| Loop: 5 steps                |         6 |   28146 |   28124 |   28186 |
| Loop: 10 steps               |        11 |   31111 |   31089 |   31096 |
| Loop: 20 steps               |        21 |   37041 |   37019 |   36916 |
| Loop: 50 steps               |        51 |   54831 |   54809 |   54376 |
| Merge: 2 x 50                |       100 |   87331 |   87305 |   86438 |
| Merge: 5 x 50                |       250 |  173774 |  173760 |  171408 |
| Merge: 10 x 50               |       500 |  319079 |  319085 |  314258 |
| Merge: 20 x 50               |      1000 |  609673 |  609719 |  599942 |
| Merge: 50 x 50               |      2500 | 1495749 | 1495915 | 1471288 |
| Middleware: 1 on linear-100  |       100 |   82024 |   82002 |   81030 |
| Middleware: 2 on linear-100  |       100 |   82252 |   82230 |   81258 |
| Middleware: 5 on linear-100  |       100 |   82969 |   82947 |   81975 |
| Middleware: 10 on linear-100 |       100 |   84445 |   84422 |   83450 |
