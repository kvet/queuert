import { describe, expect, it } from "vitest";

import { createTemplateApplier, sql, t } from "./index.js";

describe("createTemplateApplier", () => {
  describe("resolved id", () => {
    it("appends a hash suffix to the user-provided id", () => {
      const apply = createTemplateApplier({ table_prefix: "qrt_" });
      const stmt = sql("SELECT * FROM {{table_prefix}}job", { id: "getJob" });

      const resolved = apply(stmt);

      expect(resolved.id).toMatch(/^getJob@[0-9a-f]{8}$/);
      expect(resolved.sql).toBe("SELECT * FROM qrt_job");
    });

    it("produces different ids for different variable values", () => {
      const stmt = sql("SELECT * FROM {{table_prefix}}job", { id: "getJob" });

      const a = createTemplateApplier({ table_prefix: "tenant_a_" })(stmt);
      const b = createTemplateApplier({ table_prefix: "tenant_b_" })(stmt);

      expect(a.id).not.toBe(b.id);
      expect(a.id).toMatch(/^getJob@/);
      expect(b.id).toMatch(/^getJob@/);
    });

    it("produces the same id for the same resolved SQL across applier instances", () => {
      const stmt = sql("SELECT * FROM {{table_prefix}}job", { id: "getJob" });

      const a = createTemplateApplier({ table_prefix: "qrt_" })(stmt);
      const b = createTemplateApplier({ table_prefix: "qrt_" })(stmt);

      expect(a.id).toBe(b.id);
    });

    it("leaves id undefined when the input has no id", () => {
      const apply = createTemplateApplier({ table_prefix: "qrt_" });
      const stmt = sql("SELECT * FROM {{table_prefix}}job");

      const resolved = apply(stmt);

      expect(resolved.id).toBeUndefined();
      expect(resolved.sql).toBe("SELECT * FROM qrt_job");
    });

    it("folds template functions into the hash", () => {
      const stmt = sql("SELECT {{cols:id:status}} FROM job", { id: "selectCols" });

      const a = createTemplateApplier({}, { cols: (...args) => args.join(", ") })(stmt);
      const b = createTemplateApplier(
        {},
        { cols: (...args) => args.map((c) => `j.${c}`).join(", ") },
      )(stmt);

      expect(a.sql).toBe("SELECT id, status FROM job");
      expect(b.sql).toBe("SELECT j.id, j.status FROM job");
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("pure resolution", () => {
    it("resolves deterministically without retaining inputs", () => {
      const apply = createTemplateApplier({ table_prefix: "qrt_" });
      const stmt = sql("SELECT * FROM {{table_prefix}}job", { id: "getJob" });

      const first = apply(stmt);
      const second = apply(stmt);

      expect(second).not.toBe(first);
      expect(second.sql).toBe(first.sql);
      expect(second.id).toBe(first.id);
    });
  });

  describe("preserves typed-sql metadata", () => {
    it("keeps params, columns, and readOnly intact", () => {
      const apply = createTemplateApplier({ table_prefix: "qrt_" });
      const stmt = sql("SELECT id FROM {{table_prefix}}job WHERE id = ?", {
        id: "getById",
        params: [t.uuid()],
        columns: { id: t.uuid() },
        readOnly: true,
      });

      const resolved = apply(stmt);

      expect(resolved.params).toBe(stmt.params);
      expect(resolved.columns).toBe(stmt.columns);
      expect(resolved.readOnly).toBe(true);
    });
  });
});
