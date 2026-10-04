const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const elapsedMs = (from: Date, to: Date | number): number =>
  Math.max(0, (typeof to === "number" ? to : to.getTime()) - from.getTime());

/** Compact duration: `850ms`, `3.2s`, `48s`, `1m 03s`, `6m`, `2h 05m`, `3d 4h`. */
export const formatDuration = (ms: number): string => {
  const value = Math.max(0, ms);
  if (value < SECOND) return `${Math.floor(value)}ms`;
  if (value < 10 * SECOND) return `${(Math.floor(value / 100) / 10).toFixed(1)}s`;
  if (value < MINUTE) return `${Math.floor(value / SECOND)}s`;
  if (value < HOUR) {
    const minutes = Math.floor(value / MINUTE);
    const seconds = Math.floor((value % MINUTE) / SECOND);
    return seconds > 0 ? `${minutes}m ${pad2(seconds)}s` : `${minutes}m`;
  }
  if (value < DAY) {
    const hours = Math.floor(value / HOUR);
    const minutes = Math.floor((value % HOUR) / MINUTE);
    return minutes > 0 ? `${hours}h ${pad2(minutes)}m` : `${hours}h`;
  }
  const days = Math.floor(value / DAY);
  const hours = Math.floor((value % DAY) / HOUR);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
};
