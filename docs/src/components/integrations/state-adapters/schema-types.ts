export type SchemaColumn = {
  name: string;
  type: string;
  primaryKey?: boolean;
  /** Written on the chain's head row only. */
  head?: boolean;
  description?: string;
};

export type SchemaTable = {
  name: string;
  purpose: string;
  columns: SchemaColumn[];
};

export type SchemaIndex = {
  name: string;
  table: string;
  definition: string;
  purpose: string;
};
