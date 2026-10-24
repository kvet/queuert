export const isNonNegativeFinite = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Like {@link isNonNegativeFinite}, but `Infinity` passes. */
export const isNonNegative = (value: unknown): boolean => typeof value === "number" && value >= 0;

export const isPositiveFinite = (value: unknown): boolean =>
  isNonNegativeFinite(value) && value !== 0;

export const isPositiveSafeInteger = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
