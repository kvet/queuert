/**
 * Job Type Registry Measurement: ArkType
 */

import { type } from "arktype";
import { createArkTypeJobTypes } from "example-validation-arktype/adapter";

import { runValidationBenchmark } from "./validation.ts";

await runValidationBenchmark({
  name: "validation-arktype",
  title: "JOB TYPES: ARKTYPE",
  jobTypes: createArkTypeJobTypes({
    "process-order": {
      entry: true,
      input: type({
        orderId: "string",
        customer: { id: "string", email: "string.email", name: "string" },
        items: type({ sku: "string", quantity: "number.integer", price: "number" }).array(),
        "note?": "string",
      }),
      output: type({ processed: "boolean", total: "number" }),
    },
  }),
});
