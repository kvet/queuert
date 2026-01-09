import postgres, {
  PendingQuery,
  Row,
  Sql as _Sql,
  TransactionSql as _TransactionSql,
} from "postgres";

export const createSql = async ({ connectionString }: { connectionString: string }) => {
  const sql = postgres(connectionString, {
    max: 10,
  });

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS pet (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL
    )
  `;

  return sql;
};

export type Sql = _Sql;

// TransactionSql loses its call signature due to TypeScript's Omit limitation.
// We restore it by intersecting with the tagged template call signature.
// See: https://github.com/microsoft/TypeScript/issues/41362
export type TransactionSql = _TransactionSql & {
  <T extends readonly (object | undefined)[] = Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly postgres.ParameterOrFragment<never>[]
  ): PendingQuery<T>;
};
