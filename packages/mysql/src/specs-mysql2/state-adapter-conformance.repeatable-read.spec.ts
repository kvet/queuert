import { defineMysqlStateAdapterConformanceSuite } from "./state-adapter-conformance.spec-helper.ts";

await defineMysqlStateAdapterConformanceSuite({
  level: "REPEATABLE READ",
  callerId: import.meta.url,
});
