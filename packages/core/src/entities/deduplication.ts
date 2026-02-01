export type DeduplicationScope = "incomplete" | "any";

export type DeduplicationOptions = {
  key: string;
  scope?: DeduplicationScope;
  windowMs?: number;
};
