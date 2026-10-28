export const appendPage = <TItem extends { id: string }>(
  loaded: TItem[],
  page: TItem[],
): TItem[] => {
  const loadedIds = new Set(loaded.map((item) => item.id));
  return [...loaded, ...page.filter((item) => !loadedIds.has(item.id))];
};
