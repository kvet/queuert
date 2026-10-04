export const formatCount = (c: { count: number; hasMore: boolean }): string =>
  c.hasMore ? `${c.count.toLocaleString()}+` : c.count.toLocaleString();

export const formatTotalCount = (counts: { count: number; hasMore: boolean }[]): string =>
  formatCount({
    count: counts.reduce((sum, c) => sum + c.count, 0),
    hasMore: counts.some((c) => c.hasMore),
  });
