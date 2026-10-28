export const shortId = (id: string): string =>
  id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
