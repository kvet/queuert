import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { writePlansFile } from "./write-plans-file.ts";

test("writes numbered plans per section with IDs and timestamps replaced by placeholders", () => {
  const directory = mkdtempSync(join(import.meta.dirname, ".write-plans-file-"));
  try {
    const path = join(directory, "plans", "postgresql.md");

    writePlansFile({
      path,
      title: "PostgreSQL query plans",
      description: "Plans of every statement.",
      sections: [
        {
          heading: "getJobs/default",
          plans: [
            {
              label: "getJobs",
              plan: "Index Scan using queuert_job_pkey on queuert_job\n  Index Cond: (id = '0b7e4a52-9f3c-4d1e-8a6b-2c5d7e9f1a3b'::uuid)\n",
            },
            {
              label: "UPDATE `queuert_job` SET status = 'pending'",
              plan: "Filter: (scheduled_at <= '2026-11-28 10:15:00.123+00')",
            },
          ],
        },
        { heading: "stopWorker/default", plans: [] },
      ],
    });

    expect(readFileSync(path, "utf8")).toBe(
      [
        "# PostgreSQL query plans",
        "",
        "Plans of every statement.",
        "",
        "## getJobs/default",
        "",
        "1. `getJobs`",
        "",
        "```",
        "Index Scan using queuert_job_pkey on queuert_job",
        "  Index Cond: (id = '<uuid>'::uuid)",
        "```",
        "",
        "2. `` UPDATE `queuert_job` SET status = 'pending' ``",
        "",
        "```",
        "Filter: (scheduled_at <= '<timestamp>')",
        "```",
        "",
        "## stopWorker/default",
        "",
        "No query plans.",
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
