const units: [suffix: string, ms: number][] = [
  ["y", 365 * 24 * 60 * 60 * 1000],
  ["mo", 30 * 24 * 60 * 60 * 1000],
  ["d", 24 * 60 * 60 * 1000],
  ["h", 60 * 60 * 1000],
  ["m", 60 * 1000],
  ["s", 1000],
];

/** Compact relative time from `now`: `40s ago`, `in 40s`, `3h ago`, or `now` within a second. */
export const formatRelative = (date: Date, now: number): string => {
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 1000) return "now";
  const [suffix, size] = units.find(([, ms]) => abs >= ms) ?? units[units.length - 1];
  const amount = `${Math.floor(abs / size)}${suffix}`;
  return diff > 0 ? `in ${amount}` : `${amount} ago`;
};

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

export const formatAbsolute = (date: Date): string => dateTimeFormat.format(date);
