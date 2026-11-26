import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, platform, totalmem } from "node:os";
import { dirname } from "node:path";

import {
  type ResultsTable,
  environmentTableTitle,
  mergeResultsTables,
  parseResultsFile,
  renderResultsFile,
} from "./results-file.ts";

const loadAverageAtStart = loadavg()[0];

const commandOutput = (command: string, args: string[]): string | undefined => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return undefined;
  }
};

const environmentTable = (): ResultsTable => {
  const powerMode =
    platform() === "darwin"
      ? commandOutput("pmset", ["-g"])?.match(/^\s*powermode\s+(\d)/m)?.[1]
      : undefined;
  const containerEngine = commandOutput("docker", [
    "version",
    "--format",
    "{{.Server.Platform.Name}} {{(index .Server.Components 0).Version}}",
  ]);
  const operatingSystem =
    platform() === "darwin"
      ? `macOS ${commandOutput("sw_vers", ["-productVersion"])}`
      : `${platform()} ${commandOutput("uname", ["-r"])}`;
  return {
    title: environmentTableTitle,
    columns: ["Setting", "Value"],
    rows: [
      [
        "Machine",
        `${cpus()[0].model}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB`,
      ],
      ...(powerMode === undefined
        ? []
        : [
            [
              "Power mode",
              ({ "0": "Normal", "1": "Low power", "2": "High power" } as Record<string, string>)[
                powerMode
              ] ?? powerMode,
            ],
          ]),
      ["OS", operatingSystem],
      ["Runtime", `Node.js ${process.version}`],
      ...(containerEngine === undefined ? [] : [["Containers", containerEngine]]),
    ],
  };
};

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
    tables: [...mergeResultsTables(previous, tables), environmentTable()],
  });
  writeFileSync(path, content);
  return content;
};
