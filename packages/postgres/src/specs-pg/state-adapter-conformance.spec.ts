import { definePgStateAdapterConformanceSuite } from "./state-adapter-conformance.spec-helper.ts";

await definePgStateAdapterConformanceSuite({
  level: "READ COMMITTED",
  callerId: import.meta.url,
});
