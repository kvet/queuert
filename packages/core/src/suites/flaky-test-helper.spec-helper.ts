/**
 * Creates a seeded PRNG using the mulberry32 algorithm.
 * Produces reproducible random numbers for deterministic tests.
 */
export const createSeededRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Creates a function that alternates between success and error batches.
 * Used to simulate flaky connections in tests with reproducible patterns.
 * Returns true when the current call should error.
 * Alternates between success batches (5-15 calls) and error batches (1-20 calls).
 */
export const createFlakyBatchGenerator = (seed: number = 12345): (() => boolean) => {
  const random = createSeededRandom(seed);
  let inErrorBatch = false;
  let batchRemaining = Math.floor(random() * 11) + 5; // First success batch: 5-15

  return () => {
    batchRemaining--;

    if (batchRemaining <= 0) {
      inErrorBatch = !inErrorBatch;
      batchRemaining = inErrorBatch
        ? Math.floor(random() * 20) + 1 // Error batch: 1-20
        : Math.floor(random() * 11) + 5; // Success batch: 5-15
    }

    return inErrorBatch;
  };
};
