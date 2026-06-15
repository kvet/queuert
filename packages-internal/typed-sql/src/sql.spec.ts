import { describe, expect, it } from "vitest";

import { extractColumnTypes, extractParamTypes, sql, t } from "./sql.js";

describe("sql", () => {
  it("defaults readOnly, params, and columns when omitted", () => {
    const template = sql("SELECT 1");
    expect(template).toMatchObject({ sql: "SELECT 1", readOnly: false, params: [], columns: {} });
    expect(template.id).toBeUndefined();
  });

  it("carries through provided id, params, columns, and readOnly", () => {
    const template = sql("SELECT $1", {
      id: "q",
      params: [t.number()],
      columns: { name: t.string() },
      readOnly: true,
    });
    expect(template).toMatchObject({ id: "q", readOnly: true });
    expect(template.params).toHaveLength(1);
  });
});

describe("extractParamTypes / extractColumnTypes", () => {
  it("maps a params tuple to a positional runtime-type record", () => {
    expect(extractParamTypes([t.number(), t["string?"]()])).toEqual({ 0: "number", 1: "string?" });
    expect(extractParamTypes([])).toEqual({});
  });

  it("maps a columns record to a keyed runtime-type record", () => {
    expect(extractColumnTypes({ id: t.uuid(), tags: t.array() })).toEqual({
      id: "uuid",
      tags: "array",
    });
  });
});
