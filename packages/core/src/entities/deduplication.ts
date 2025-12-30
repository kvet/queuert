export type DeduplicationStrategy = "completed" | "all";

export type DeduplicationOptions = {
  key: string;
  strategy?: DeduplicationStrategy;
  windowMs?: number;
};
