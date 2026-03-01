/** Cursor-based pagination parameters. */
export type PageParams = {
  /** Opaque cursor from a previous page's `nextCursor`. Omit for the first page. */
  cursor?: string;
  /** Maximum number of items to return. */
  limit: number;
};

/** A page of results with an optional cursor to the next page. */
export type Page<T> = {
  items: T[];
  /** Cursor to fetch the next page, or `null` if this is the last page. */
  nextCursor: string | null;
};

/** Sort direction for paginated queries. */
export type OrderDirection = "asc" | "desc";
