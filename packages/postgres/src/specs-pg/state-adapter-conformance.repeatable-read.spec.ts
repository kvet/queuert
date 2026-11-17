import { definePgStateAdapterConformanceSuite } from "./state-adapter-conformance.spec-helper.ts";

await definePgStateAdapterConformanceSuite({
  level: "REPEATABLE READ",
  callerId: import.meta.url,
});
