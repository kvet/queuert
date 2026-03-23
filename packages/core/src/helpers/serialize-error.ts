const MAX_LENGTH = 10_000;

const truncate = (s: string): string =>
  s.length <= MAX_LENGTH ? s : `${s.slice(0, MAX_LENGTH)}… [truncated]`;

export const serializeError = (err: unknown): string => {
  if (err == null) return String(err);
  if (typeof err === "string") return truncate(err);
  if (err instanceof Error) {
    const base = err.stack ?? err.message;
    const ownKeys = Object.keys(err);
    if (ownKeys.length === 0) return truncate(base);
    const props: Record<string, unknown> = {};
    for (const k of ownKeys) {
      props[k] = (err as unknown as Record<string, unknown>)[k];
    }
    try {
      return truncate(`${base}\n${JSON.stringify(props)}`);
    } catch {
      return truncate(base);
    }
  }
  try {
    return truncate(JSON.stringify(err));
  } catch {
    if (typeof err === "object") {
      const allKeys = Object.keys(err as Record<string, unknown>);
      const keys = allKeys.slice(0, 5);
      const entries = keys.map((k) => `${k}: ${String((err as Record<string, unknown>)[k])}`);
      if (allKeys.length > keys.length) entries.push("…");
      return truncate(`{${entries.join(", ")}}`);
    }
    // oxlint-disable-next-line no-base-to-string
    return truncate(String(err));
  }
};
