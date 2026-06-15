import { type DataType, type TypedSql, type TypedSqlTemplate } from "./sql.js";

const fnv1aHex = (input: string): string => {
  const len = input.length;
  const tail = len & 3;
  const end = len - tail;
  let hash = 0x811c9dc5;
  let i = 0;
  for (; i < end; i += 4) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193);
    hash = Math.imul(hash ^ input.charCodeAt(i + 1), 0x01000193);
    hash = Math.imul(hash ^ input.charCodeAt(i + 2), 0x01000193);
    hash = Math.imul(hash ^ input.charCodeAt(i + 3), 0x01000193);
  }
  for (; i < len; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export type TemplateApplier = <
  TParams extends readonly DataType[],
  TColumns extends Record<string, DataType>,
>(
  typedSql: TypedSqlTemplate<TParams, TColumns>,
) => TypedSql<TParams, TColumns>;

export const createTemplateApplier = (
  variables: Record<string, string>,
  functions?: Record<string, (...args: string[]) => string>,
): TemplateApplier => {
  const variableEntries = Object.entries(variables);
  const functionEntries = functions ? Object.entries(functions) : [];

  return <TParams extends readonly DataType[], TColumns extends Record<string, DataType>>(
    typedSql: TypedSqlTemplate<TParams, TColumns>,
  ): TypedSql<TParams, TColumns> => {
    let resolvedSql = typedSql.sql;
    for (const [key, value] of variableEntries) {
      resolvedSql = resolvedSql.replaceAll(`{{${key}}}`, value);
    }
    for (const [name, fn] of functionEntries) {
      const pattern = new RegExp(`\\{\\{${name}:([^}]+)\\}\\}`, "g");
      resolvedSql = resolvedSql.replace(pattern, (_, argsStr: string) => {
        const args = argsStr.split(":");
        return fn(...args);
      });
    }
    const resolvedId =
      typedSql.id !== undefined ? `${typedSql.id}@${fnv1aHex(resolvedSql)}` : undefined;
    return { ...typedSql, id: resolvedId, sql: resolvedSql } as TypedSql<TParams, TColumns>;
  };
};
