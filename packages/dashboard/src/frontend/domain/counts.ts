export type CappedCount = { count: number; hasMore: boolean };

/** `1,234`, or `10,000+` when the server stopped counting at its cap. */
export const formatCount = (capped: CappedCount): string =>
  capped.hasMore ? `${capped.count.toLocaleString()}+` : capped.count.toLocaleString();

/** Sums capped counts; the result is a lower bound (`hasMore`) when any input was capped. */
export const sumCounts = (counts: CappedCount[]): CappedCount => ({
  count: counts.reduce((sum, capped) => sum + capped.count, 0),
  hasMore: counts.some((capped) => capped.hasMore),
});

/** Renders a sum: `≥10,000` when it includes a capped value, otherwise the plain number. */
export const formatSum = (capped: CappedCount): string =>
  capped.hasMore ? `≥${capped.count.toLocaleString()}` : capped.count.toLocaleString();
