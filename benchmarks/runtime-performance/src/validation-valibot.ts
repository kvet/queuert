/**
 * Job Type Registry Measurement: Valibot
 */

import { createValibotJobTypes } from "example-validation-valibot/adapter";
import * as v from "valibot";

import { runValidationBenchmark } from "./validation.ts";

await runValidationBenchmark({
  name: "validation-valibot",
  title: "JOB TYPES: VALIBOT",
  jobTypes: createValibotJobTypes({
    "process-order": {
      entry: true,
      input: v.object({
        orderId: v.string(),
        customer: v.object({
          id: v.string(),
          email: v.pipe(v.string(), v.email()),
          name: v.string(),
        }),
        items: v.array(
          v.object({
            sku: v.string(),
            quantity: v.pipe(v.number(), v.integer()),
            price: v.number(),
          }),
        ),
        note: v.optional(v.string()),
      }),
      output: v.object({ processed: v.boolean(), total: v.number() }),
    },
  }),
});
