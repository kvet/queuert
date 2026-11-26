import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { environmentTableTitle, parseResultsFile } from "./results-file.ts";
import { writeResultsFile } from "./write-results-file.ts";

test("records the run's environment as the last table, replacing the earlier one", () => {
  const directory = mkdtempSync(join(import.meta.dirname, ".write-results-file-"));
  try {
    const path = join(directory, "results.md");
    writeFileSync(
      path,
      [
        "# Query performance",
        "",
        "Last run",
        "",
        "## Counts",
        "",
        "| Query | PostgreSQL |",
        "| ----- | ---------: |",
        "| count |       0.50 |",
        "",
        `## ${environmentTableTitle}`,
        "",
        "| Setting    | Value          |",
        "| ---------- | -------------: |",
        "| Containers | Docker Desktop |",
        "",
      ].join("\n"),
    );

    writeResultsFile({
      path,
      title: "Query performance",
      ran: "PostgreSQL",
      tables: [{ title: "Counts", columns: ["Query", "PostgreSQL"], rows: [["count", "-"]] }],
    });

    const tables = parseResultsFile(readFileSync(path, "utf8"));
    expect(tables.map((table) => table.title)).toEqual(["Counts", environmentTableTitle]);
    expect(tables[0].rows).toEqual([["count", "0.50"]]);
    const environment = Object.fromEntries(tables[1].rows);
    expect(environment.Runtime).toBe(`Node.js ${process.version}`);
    expect(environment.Machine).toMatch(/, \d+ cores, \d+ GB$/);
    expect(environment.Containers).not.toBe("Docker Desktop");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
