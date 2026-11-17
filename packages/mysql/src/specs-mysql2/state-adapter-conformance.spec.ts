import { defineMysqlStateAdapterConformanceSuite } from "./state-adapter-conformance.spec-helper.ts";

await defineMysqlStateAdapterConformanceSuite({
  level: "READ COMMITTED",
  callerId: import.meta.url,
});
