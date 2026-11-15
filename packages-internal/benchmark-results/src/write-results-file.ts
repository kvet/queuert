import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname } from "node:path";

import {
  type ResultsTable,
  mergeResultsTables,
  parseResultsFile,
  renderResultsFile,
} from "./results-file.ts";

const loadAverageAtStart = loadavg()[0];

export const writeResultsFile = ({
  path,
  title,
  ran,
  tables,
}: {
  path: string;
  title: string;
  ran: string;
  tables: ResultsTable[];
}): string => {
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: dirname(path),
    encoding: "utf8",
  }).trim();
  const date = new Date().toISOString().slice(0, 10);
  const previous = existsSync(path) ? parseResultsFile(readFileSync(path, "utf8")) : [];
  const content = renderResultsFile({
    title,
    run: `Last run ${date} · commit ${commit} · load average ${loadAverageAtStart.toFixed(2)} · ${ran}`,
    tables: mergeResultsTables(previous, tables),
  });
  writeFileSync(path, content);
  return content;
};
