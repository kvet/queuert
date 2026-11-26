# Type complexity

Last run 2026-11-26 · commit 23926ee8 · load average 2.23 · TS 6, TS 7, tsrs

## Type-check time (ms)

| Scenario                     | TS 6 | TS 7 | tsrs |
| ---------------------------- | ---: | ---: | ---: |
| Linear: 1 type               |  371 |   77 |   46 |
| Linear: 5 types              |  341 |   80 |   46 |
| Linear: 10 types             |  349 |   87 |   50 |
| Linear: 20 types             |  365 |   90 |   50 |
| Linear: 50 types             |  410 |  102 |   53 |
| Linear: 100 types            |  460 |  113 |   56 |
| Branched: 2w x 2d            |  341 |   84 |   48 |
| Branched: 3w x 3d            |  392 |   95 |   50 |
| Branched: 4w x 3d            |  442 |  108 |   55 |
| Branched: 2w x 6d            |  514 |  131 |   66 |
| Blockers: 3 steps            |  343 |   86 |   51 |
| Blockers: 8 steps            |  384 |   97 |   53 |
| Blockers: 15 steps           |  444 |  118 |   56 |
| Blockers: 25 steps           |  519 |  140 |   61 |
| Loop: 5 steps                |  334 |   84 |   48 |
| Loop: 10 steps               |  346 |   85 |   49 |
| Loop: 20 steps               |  353 |   89 |   54 |
| Loop: 50 steps               |  398 |   98 |   54 |
| Merge: 2 x 50                |  438 |  107 |   55 |
| Merge: 5 x 50                |  576 |  146 |   66 |
| Merge: 10 x 50               |  795 |  216 |   80 |
| Merge: 20 x 50               | 1202 |  364 |  117 |
| Merge: 50 x 50               | 2836 |  943 |  272 |
| Middleware: 1 on linear-100  |  464 |  112 |   58 |
| Middleware: 2 on linear-100  |  463 |  114 |   59 |
| Middleware: 5 on linear-100  |  468 |  113 |   55 |
| Middleware: 10 on linear-100 |  473 |  114 |   55 |

## Instantiations

| Scenario                     | Job types |    TS 6 |    TS 7 |    tsrs |
| ---------------------------- | --------: | ------: | ------: | ------: |
| Linear: 1 type               |         1 |   28588 |   28661 |   28813 |
| Linear: 5 types              |         5 |   31239 |   31312 |   31469 |
| Linear: 10 types             |        10 |   34349 |   34422 |   34584 |
| Linear: 20 types             |        20 |   40569 |   40642 |   40814 |
| Linear: 50 types             |        50 |   59229 |   59302 |   59504 |
| Linear: 100 types            |       100 |   90329 |   90402 |   90654 |
| Branched: 2w x 2d            |         7 |   32516 |   32598 |   32757 |
| Branched: 3w x 3d            |        40 |   53243 |   53394 |   53586 |
| Branched: 4w x 3d            |        85 |   81524 |   81786 |   82023 |
| Branched: 2w x 6d            |       127 |  107816 |  108078 |  108357 |
| Blockers: 3 steps            |        10 |   39932 |   40023 |   40185 |
| Blockers: 8 steps            |        30 |   64862 |   64998 |   65180 |
| Blockers: 15 steps           |        58 |  105812 |  106011 |  106221 |
| Blockers: 25 steps           |        98 |  176552 |  176841 |  177091 |
| Loop: 5 steps                |         6 |   32221 |   32294 |   32452 |
| Loop: 10 steps               |        11 |   35411 |   35484 |   35647 |
| Loop: 20 steps               |        21 |   41791 |   41864 |   42037 |
| Loop: 50 steps               |        51 |   60931 |   61004 |   61207 |
| Merge: 2 x 50                |       100 |   95660 |   95728 |   96085 |
| Merge: 5 x 50                |       250 |  188916 |  188993 |  189665 |
| Merge: 10 x 50               |       500 |  345576 |  345668 |  346865 |
| Merge: 20 x 50               |      1000 |  658880 |  659002 |  661249 |
| Merge: 50 x 50               |      2500 | 1613086 | 1613298 | 1618695 |
| Middleware: 1 on linear-100  |       100 |   90329 |   90402 |   90654 |
| Middleware: 2 on linear-100  |       100 |   90722 |   90795 |   91047 |
| Middleware: 5 on linear-100  |       100 |   91634 |   91707 |   91959 |
| Middleware: 10 on linear-100 |       100 |   93435 |   93507 |   93759 |

## Environment

| Setting    |                         Value |
| ---------- | ----------------------------: |
| Machine    | Apple M5 Pro, 15 cores, 48 GB |
| Power mode |                        Normal |
| OS         |                  macOS 26.7.3 |
| Runtime    |              Node.js v24.22.1 |
| Containers |              socktainer 1.6.1 |
