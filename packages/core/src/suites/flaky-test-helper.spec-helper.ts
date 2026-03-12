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
 */
export const createFlakyBatchGenerator = ({
  seed = 12345,
  errorBatchSize = { min: 1, max: 20 },
  successBatchSize = { min: 4, max: 15 },
}: {
  seed?: number;
  errorBatchSize?: { min: number; max: number };
  successBatchSize?: { min: number; max: number };
} = {}): (() => boolean) => {
  const random = createSeededRandom(seed);
  const range = (r: { min: number; max: number }) =>
    Math.floor(random() * (r.max - r.min + 1)) + r.min;
  let inErrorBatch = false;
  let batchRemaining = range(successBatchSize);

  return () => {
    batchRemaining--;

    if (batchRemaining <= 0) {
      inErrorBatch = !inErrorBatch;
      batchRemaining = range(inErrorBatch ? errorBatchSize : successBatchSize);
    }

    return inErrorBatch;
  };
};
