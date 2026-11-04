import { expect, test } from "vitest";

import { benchmarkHeadlines } from "./benchmarks.ts";

test("headline numbers are picked from the measured rows", () => {
  expect(benchmarkHeadlines).toEqual({
    postgresCompletion: 2327,
    sqliteCompletion: 7994,
    postgresBatchedCreation: 30241,
    retainedAfterClose: { min: 10, max: 25 },
    postgresOperational: { min: 1.05, max: 4.99 },
    sqliteOperationalMax: 0.52,
    typeCheck100: [810, 159, 77],
    typeCheck2500: [5532, 1430, 422],
  });
});
