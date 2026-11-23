# Type complexity

Last run 2026-11-23 · commit e279ddec · load average 3.04 · TS 6, TS 7, tsrs

## Type-check time (ms)

| Scenario                     | TS 6 | TS 7 | tsrs |
| ---------------------------- | ---: | ---: | ---: |
| Linear: 1 type               |  323 |   81 |   47 |
| Linear: 5 types              |  332 |   82 |   47 |
| Linear: 10 types             |  337 |   83 |   49 |
| Linear: 20 types             |  348 |   87 |   48 |
| Linear: 50 types             |  390 |   96 |   51 |
| Linear: 100 types            |  462 |  115 |   54 |
| Branched: 2w x 2d            |  337 |   84 |   47 |
| Branched: 3w x 3d            |  382 |   92 |   49 |
| Branched: 4w x 3d            |  448 |  108 |   54 |
| Branched: 2w x 6d            |  515 |  131 |   59 |
| Blockers: 3 steps            |  349 |   87 |   49 |
| Blockers: 8 steps            |  384 |   96 |   52 |
| Blockers: 15 steps           |  444 |  112 |   55 |
| Blockers: 25 steps           |  527 |  140 |   62 |
| Loop: 5 steps                |  338 |   83 |   48 |
| Loop: 10 steps               |  345 |   84 |   47 |
| Loop: 20 steps               |  358 |   86 |   48 |
| Loop: 50 steps               |  399 |  100 |   51 |
| Merge: 2 x 50                |  447 |  109 |   55 |
| Merge: 5 x 50                |  579 |  148 |   65 |
| Merge: 10 x 50               |  795 |  214 |   79 |
| Merge: 20 x 50               | 1236 |  363 |  117 |
| Merge: 50 x 50               | 2857 |  951 |  265 |
| Middleware: 1 on linear-100  |  465 |  114 |   55 |
| Middleware: 2 on linear-100  |  464 |  115 |   56 |
| Middleware: 5 on linear-100  |  477 |  117 |   55 |
| Middleware: 10 on linear-100 |  480 |  117 |   56 |

## Instantiations

| Scenario                     | Job types |    TS 6 |    TS 7 |    tsrs |
| ---------------------------- | --------: | ------: | ------: | ------: |
| Linear: 1 type               |         1 |   28595 |   28668 |   28820 |
| Linear: 5 types              |         5 |   31246 |   31319 |   31476 |
| Linear: 10 types             |        10 |   34356 |   34429 |   34591 |
| Linear: 20 types             |        20 |   40576 |   40649 |   40821 |
| Linear: 50 types             |        50 |   59236 |   59309 |   59511 |
| Linear: 100 types            |       100 |   90336 |   90409 |   90661 |
| Branched: 2w x 2d            |         7 |   32523 |   32605 |   32764 |
| Branched: 3w x 3d            |        40 |   53250 |   53401 |   53593 |
| Branched: 4w x 3d            |        85 |   81531 |   81793 |   82030 |
| Branched: 2w x 6d            |       127 |  107823 |  108085 |  108364 |
| Blockers: 3 steps            |        10 |   39939 |   40030 |   40192 |
| Blockers: 8 steps            |        30 |   64869 |   65005 |   65187 |
| Blockers: 15 steps           |        58 |  105819 |  106018 |  106228 |
| Blockers: 25 steps           |        98 |  176559 |  176848 |  177098 |
| Loop: 5 steps                |         6 |   32228 |   32301 |   32459 |
| Loop: 10 steps               |        11 |   35418 |   35491 |   35654 |
| Loop: 20 steps               |        21 |   41798 |   41871 |   42044 |
| Loop: 50 steps               |        51 |   60938 |   61011 |   61214 |
| Merge: 2 x 50                |       100 |   95667 |   95735 |   96092 |
| Merge: 5 x 50                |       250 |  188923 |  189000 |  189672 |
| Merge: 10 x 50               |       500 |  345583 |  345675 |  346872 |
| Merge: 20 x 50               |      1000 |  658887 |  659009 |  661256 |
| Merge: 50 x 50               |      2500 | 1613093 | 1613305 | 1618702 |
| Middleware: 1 on linear-100  |       100 |   90336 |   90409 |   90661 |
| Middleware: 2 on linear-100  |       100 |   90729 |   90802 |   91054 |
| Middleware: 5 on linear-100  |       100 |   91641 |   91714 |   91966 |
| Middleware: 10 on linear-100 |       100 |   93442 |   93514 |   93766 |
