export type PageParams = {
  cursor?: string;
  limit: number;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type OrderDirection = "asc" | "desc";
