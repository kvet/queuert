export const loadedItems = <TItem extends { id: string }>(pages: { items: TItem[] }[]): TItem[] => {
  const seen = new Set<string>();
  const items: TItem[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
};

export const loadedAnnouncement = (pages: { items: unknown[] }[], noun = ""): string =>
  pages.length > 1
    ? `Loaded ${pages[pages.length - 1].items.length} more${noun ? ` ${noun}` : ""}`
    : "";

export const shouldLoadNextPage = (query: {
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchNextPageError: boolean;
}): boolean => query.hasNextPage && !query.isFetching && !query.isFetchNextPageError;
