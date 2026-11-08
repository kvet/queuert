/**
 * Job Type Registry Measurement: Zod
 */

import { createZodJobTypes } from "example-validation-zod/adapter";
import { z } from "zod";

import { runValidationBenchmark } from "./validation.ts";

await runValidationBenchmark({
  name: "validation-zod",
  title: "JOB TYPES: ZOD",
  jobTypes: createZodJobTypes({
    "process-order": {
      entry: true,
      input: z.object({
        orderId: z.string(),
        customer: z.object({ id: z.string(), email: z.email(), name: z.string() }),
        items: z.array(z.object({ sku: z.string(), quantity: z.int(), price: z.number() })),
        note: z.string().optional(),
      }),
      output: z.object({ processed: z.boolean(), total: z.number() }),
    },
  }),
});
