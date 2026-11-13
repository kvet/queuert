const MAX_CHUNK_LENGTH = 512;

export type SortedList<T> = {
  readonly compare: (a: T, b: T) => number;
  readonly chunks: T[][];
  size: number;
};

const firstIndexWhere = <T>(items: T[], predicate: (item: T) => boolean): number => {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (predicate(items[middle])) high = middle;
    else low = middle + 1;
  }
  return low;
};

const lowerBound = <T>(items: T[], item: T, compare: (a: T, b: T) => number): number => {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(items[middle], item) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
};

const chunkIndexOf = <T>(list: SortedList<T>, item: T): number => {
  const { chunks, compare } = list;
  let low = 0;
  let high = chunks.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const chunk = chunks[middle];
    if (compare(chunk[chunk.length - 1], item) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
};

export const createSortedList = <T>(
  compare: (a: T, b: T) => number,
  sortedItems: T[] = [],
): SortedList<T> => {
  const chunks: T[][] = [];
  for (let start = 0; start < sortedItems.length; start += MAX_CHUNK_LENGTH >>> 1) {
    chunks.push(sortedItems.slice(start, start + (MAX_CHUNK_LENGTH >>> 1)));
  }
  return { compare, chunks, size: sortedItems.length };
};

export const firstOfSortedList = <T>(list: SortedList<T>): T | undefined =>
  list.chunks.length === 0 ? undefined : list.chunks[0][0];

export const insertIntoSortedList = <T>(list: SortedList<T>, item: T): void => {
  const { chunks, compare } = list;
  list.size++;
  if (chunks.length === 0) {
    chunks.push([item]);
    return;
  }
  let chunkIndex = chunks.length - 1;
  let chunk = chunks[chunkIndex];
  if (compare(chunk[chunk.length - 1], item) < 0) {
    chunk.push(item);
  } else {
    chunkIndex = chunkIndexOf(list, item);
    chunk = chunks[chunkIndex];
    chunk.splice(lowerBound(chunk, item, compare), 0, item);
  }
  if (chunk.length > MAX_CHUNK_LENGTH) {
    chunks.splice(chunkIndex + 1, 0, chunk.splice(chunk.length >>> 1));
  }
};

export const deleteFromSortedList = <T>(list: SortedList<T>, item: T): boolean => {
  const { chunks, compare } = list;
  if (chunks.length === 0) return false;
  const chunkIndex = chunkIndexOf(list, item);
  const chunk = chunks[chunkIndex];
  const index = chunk[0] === item ? 0 : lowerBound(chunk, item, compare);
  if (chunk[index] !== item) return false;
  if (index === 0) chunk.shift();
  else chunk.splice(index, 1);
  list.size--;
  if (chunk.length === 0) chunks.splice(chunkIndex, 1);
  return true;
};

export const takeFromSortedList = <T>(
  list: SortedList<T>,
  direction: "asc" | "desc",
  skip: (item: T) => boolean,
  stop: ((item: T) => boolean) | undefined,
  limit: number,
): T[] => {
  const { chunks } = list;
  const items: T[] = [];
  if (limit <= 0) return items;
  if (direction === "asc") {
    const startChunkIndex = firstIndexWhere(chunks, (chunk) => !skip(chunk[chunk.length - 1]));
    for (let chunkIndex = startChunkIndex; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const startIndex =
        chunkIndex === startChunkIndex ? firstIndexWhere(chunk, (item) => !skip(item)) : 0;
      for (let index = startIndex; index < chunk.length; index++) {
        const item = chunk[index];
        if (stop !== undefined && stop(item)) return items;
        items.push(item);
        if (items.length === limit) return items;
      }
    }
    return items;
  }
  const startChunkIndex = firstIndexWhere(chunks, (chunk) => skip(chunk[0])) - 1;
  for (let chunkIndex = startChunkIndex; chunkIndex >= 0; chunkIndex--) {
    const chunk = chunks[chunkIndex];
    const startIndex =
      chunkIndex === startChunkIndex ? firstIndexWhere(chunk, skip) - 1 : chunk.length - 1;
    for (let index = startIndex; index >= 0; index--) {
      const item = chunk[index];
      if (stop !== undefined && stop(item)) return items;
      items.push(item);
      if (items.length === limit) return items;
    }
  }
  return items;
};

export const sortedListToArray = <T>(list: SortedList<T>): T[] => list.chunks.flat();
