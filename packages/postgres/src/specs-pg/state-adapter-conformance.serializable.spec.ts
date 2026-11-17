import { definePgStateAdapterConformanceSuite } from "./state-adapter-conformance.spec-helper.ts";

await definePgStateAdapterConformanceSuite({
  level: "SERIALIZABLE",
  callerId: import.meta.url,
});
