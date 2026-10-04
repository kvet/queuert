/** Whether two lists hold the same items (by ID) in the same order. */
export const sameIds = (a: { id: string }[], b: { id: string }[]): boolean =>
  a.length === b.length && a.every((item, index) => item.id === b[index].id);

/**
 * Appends the next page to the loaded items, skipping items already loaded: a row whose sort key
 * changed between page fetches can come back on the next page too.
 */
export const appendPage = <TItem extends { id: string }>(
  loaded: TItem[],
  page: TItem[],
): TItem[] => {
  const loadedIds = new Set(loaded.map((item) => item.id));
  return [...loaded, ...page.filter((item) => !loadedIds.has(item.id))];
};

/**
 * How a refreshed first page lands on a list without moving it: on an empty list it becomes the
 * list; when its IDs match the top of the list those rows are updated in place; otherwise it is
 * held back (`fresh`) so the user can choose to show it.
 */
export const mergeRefreshedPage = <TItem extends { id: string }>(
  loaded: TItem[],
  page: TItem[],
): { kind: "replace" } | { kind: "update"; items: TItem[] } | { kind: "fresh" } => {
  if (loaded.length === 0) return { kind: "replace" };
  if (page.length > 0 && sameIds(loaded.slice(0, page.length), page)) {
    return { kind: "update", items: [...page, ...loaded.slice(page.length)] };
  }
  return { kind: "fresh" };
};

/**
 * Swaps a refreshed first page into a list that may hold later pages: the old first page
 * (`firstPageSize` items) is replaced, and later items that moved onto the new first page are
 * dropped so they don't show twice.
 */
export const replaceFirstPage = <TItem extends { id: string }>(
  loaded: TItem[],
  firstPageSize: number,
  page: TItem[],
): TItem[] => {
  const pageIds = new Set(page.map((item) => item.id));
  return [...page, ...loaded.slice(firstPageSize).filter((item) => !pageIds.has(item.id))];
};
