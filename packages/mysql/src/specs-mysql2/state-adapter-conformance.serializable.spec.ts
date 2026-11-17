import { defineMysqlStateAdapterConformanceSuite } from "./state-adapter-conformance.spec-helper.ts";

await defineMysqlStateAdapterConformanceSuite({
  level: "SERIALIZABLE",
  callerId: import.meta.url,
});
