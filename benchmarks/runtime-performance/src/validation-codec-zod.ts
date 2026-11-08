/**
 * Job Type Registry Measurement: Zod codec adapter (z.encode / z.decode)
 */

import { createZodCodecJobTypes } from "example-codec-zod/adapter";
import { z } from "zod";

import { runValidationBenchmark } from "./validation.ts";

await runValidationBenchmark({
  name: "validation-codec-zod",
  title: "JOB TYPES: ZOD CODEC",
  jobTypes: createZodCodecJobTypes({
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
