# Type complexity

Last run 2026-11-26 · commit 28448c56 · load average 4.68 · TS 6, TS 7, tsrs

## Type-check time (ms)

| Scenario                     | TS 6 | TS 7 | tsrs |
| ---------------------------- | ---: | ---: | ---: |
| Linear: 1 type               |  318 |   77 |   45 |
| Linear: 5 types              |  322 |   79 |   45 |
| Linear: 10 types             |  331 |   82 |   48 |
| Linear: 20 types             |  335 |   84 |   48 |
| Linear: 50 types             |  391 |   94 |   49 |
| Linear: 100 types            |  445 |  110 |   53 |
| Branched: 2w x 2d            |  323 |   79 |   46 |
| Branched: 3w x 3d            |  367 |   90 |   48 |
| Branched: 4w x 3d            |  430 |  104 |   52 |
| Branched: 2w x 6d            |  496 |  126 |   56 |
| Blockers: 3 steps            |  336 |   84 |   47 |
| Blockers: 8 steps            |  378 |   94 |   50 |
| Blockers: 15 steps           |  428 |  107 |   53 |
| Blockers: 25 steps           |  512 |  134 |   59 |
| Loop: 5 steps                |  323 |   80 |   45 |
| Loop: 10 steps               |  335 |   80 |   48 |
| Loop: 20 steps               |  343 |   85 |   46 |
| Loop: 50 steps               |  387 |   93 |   50 |
| Merge: 2 x 50                |  436 |  106 |   53 |
| Merge: 5 x 50                |  559 |  143 |   61 |
| Merge: 10 x 50               |  768 |  205 |   78 |
| Merge: 20 x 50               | 1177 |  350 |  112 |
| Merge: 50 x 50               | 2744 |  916 |  254 |
| Middleware: 1 on linear-100  |  451 |  111 |   52 |
| Middleware: 2 on linear-100  |  455 |  112 |   52 |
| Middleware: 5 on linear-100  |  458 |  111 |   53 |
| Middleware: 10 on linear-100 |  463 |  115 |   53 |

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

| Setting    |                                  Value |
| ---------- | -------------------------------------: |
| Machine    |          Apple M5 Pro, 15 cores, 48 GB |
| Power mode |                                 Normal |
| OS         |                           macOS 26.7.3 |
| Runtime    |                       Node.js v24.22.1 |
| Containers | Docker Desktop 4.100.1 (247138) 29.9.3 |
