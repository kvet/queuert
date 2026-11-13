import {
  type IndexDefinition,
  placeholder,
  placeholderFields,
  symbolicIndex,
} from "./schema.redis.ts";

const luaString = (text: string): string => `'${text.replaceAll(/[\\']/g, "\\$&")}'`;

const luaValue = (value: string | number): string =>
  typeof value === "number" ? String(value) : luaString(value);

export const toLua = (symbolic: string, resolve: (field: string) => string): string => {
  const parts = symbolic
    .split("\0")
    .flatMap((part, index) =>
      index % 2 === 1 ? [resolve(part)] : part === "" ? [] : [luaString(part)],
    );
  return parts.length === 0 ? "''" : parts.join(" .. ");
};

export const keyLua = (symbolicKey: string, variables: Record<string, string> = {}): string =>
  toLua(symbolicKey, (field) => {
    if (field === "prefix") return "prefix";
    const variable = variables[field];
    if (variable === undefined) throw new Error(`No Lua variable for key field "${field}"`);
    return variable;
  });

type StaticValues = Readonly<Record<string, string | number | null>>;

export const indexTransitionLua = <TRecord>({
  definitions,
  record,
  changed,
  nonNull,
  before,
  after,
}: {
  definitions: IndexDefinition<TRecord>[];
  record: string;
  changed: readonly string[];
  nonNull: readonly string[];
  before: StaticValues;
  after: StaticValues;
}): string => {
  const lines: string[] = [];
  for (const definition of definitions) {
    const { key, member } = symbolicIndex(definition);
    const entryFields = [
      ...new Set([
        ...placeholderFields(key),
        ...placeholderFields(member),
        ...(definition.score === undefined ? [] : [definition.score]),
      ]),
    ].filter((field) => field !== "prefix");
    const where = Object.entries(definition.where ?? {}) as [string, string | number][];
    const touched = [...entryFields, ...where.map(([field]) => field)].some((field) =>
      changed.includes(field),
    );
    if (!touched) continue;
    if (definition.each !== undefined || definition.type === "set") {
      throw new Error(`The index ${definition.name} cannot be moved by a compiled transition`);
    }

    const side = (values: StaticValues, dynamicChanged: boolean) => {
      const guards: string[] = [];
      const valueOf = (field: string): string => {
        if (field in values) {
          const value = values[field];
          if (value === null) throw new Error(`Index field "${field}" is null`);
          return luaValue(value);
        }
        if (changed.includes(field) && !dynamicChanged) {
          throw new Error(
            `The index ${definition.name} needs a value of "${field}" before the move`,
          );
        }
        return `${record}.${field}`;
      };
      for (const [field, expected] of where) {
        if (field in values) {
          if (values[field] !== expected) return undefined;
        } else {
          guards.push(`${valueOf(field)} == ${luaValue(expected)}`);
        }
      }
      for (const field of entryFields) {
        if (field in values) {
          if (values[field] === null) return undefined;
        } else if (!nonNull.includes(field)) {
          guards.push(`${valueOf(field)} ~= nil and ${valueOf(field)} ~= cjson.null`);
        }
      }
      const substitute = (symbolic: string): string =>
        symbolic
          .split("\0")
          .map((part, index) =>
            index % 2 === 0 ? part : part in values ? String(values[part]) : placeholder(part),
          )
          .join("");
      const resolve = (field: string): string => (field === "prefix" ? "prefix" : valueOf(field));
      return {
        guards: guards.join(" and "),
        key: toLua(substitute(key), resolve),
        member: toLua(substitute(member), resolve),
        score: definition.score === undefined ? undefined : resolve(definition.score),
      };
    };

    const removal = side(before, false);
    const addition = side(after, true);
    const samePlace =
      removal !== undefined &&
      addition !== undefined &&
      removal.key === addition.key &&
      removal.member === addition.member &&
      removal.guards === addition.guards;
    const guarded = (guards: string, statement: string): string =>
      guards === "" ? statement : `if ${guards} then ${statement} end`;

    if (removal !== undefined && !samePlace) {
      lines.push(
        guarded(
          removal.guards,
          definition.type === "zset"
            ? `redis.call('ZREM', ${removal.key}, ${removal.member})`
            : `if redis.call('HINCRBY', ${removal.key}, ${removal.member}, -1) <= 0 then redis.call('HDEL', ${removal.key}, ${removal.member}) end`,
        ),
      );
    }
    const scoreMoves = definition.type === "zset" && changed.includes(definition.score ?? "");
    if (addition !== undefined && (!samePlace || scoreMoves)) {
      lines.push(
        guarded(
          addition.guards,
          definition.type === "zset"
            ? `redis.call('ZADD', ${addition.key}, ${addition.score}, ${addition.member})`
            : `redis.call('HINCRBY', ${addition.key}, ${addition.member}, 1)`,
        ),
      );
    }
  }
  return lines.join("\n");
};
