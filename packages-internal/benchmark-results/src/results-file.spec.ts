import { describe, expect, test } from "vitest";

import { mergeResultsTables, parseResultsFile, renderResultsFile } from "./results-file.ts";

describe("renderResultsFile", () => {
  test("pads every table into aligned columns, right-aligning the numbers", () => {
    expect(
      renderResultsFile({
        title: "Processing capacity",
        run: "Last run 2026-11-15 · commit abc1234 · load average 1.50 · all adapters",
        tables: [
          {
            title: "Creation (chains/s): State adapter (noop notify)",
            columns: ["Adapter", "Single", "Batched (100)"],
            rows: [
              ["In-process", "298602", "428016"],
              ["PostgreSQL (pg)", "899", "-"],
            ],
          },
        ],
      }),
    ).toBe(
      [
        "# Processing capacity",
        "",
        "Last run 2026-11-15 · commit abc1234 · load average 1.50 · all adapters",
        "",
        "## Creation (chains/s): State adapter (noop notify)",
        "",
        "| Adapter         | Single | Batched (100) |",
        "| --------------- | -----: | ------------: |",
        "| In-process      | 298602 |        428016 |",
        "| PostgreSQL (pg) |    899 |             - |",
        "",
      ].join("\n"),
    );
  });
});

describe("parseResultsFile", () => {
  test("reads back every table a render wrote, by its heading", () => {
    const tables = [
      {
        title: "Memory (KB)",
        columns: ["Measurement", "Setup", "In-flight peak"],
        rows: [
          ["notify-redis", "70", "300"],
          ["state-sqlite", "100", "-"],
        ],
      },
      { title: "Allocated per job (KB)", columns: ["Measurement", "Allocated"], rows: [] },
      {
        title: "CPU per job (µs)",
        columns: ["Measurement", "Queuert core"],
        rows: [["otel", "48"]],
      },
    ];

    expect(
      parseResultsFile(
        renderResultsFile({ title: "Runtime performance", run: "Last run", tables }),
      ),
    ).toEqual(tables);
  });
});

describe("mergeResultsTables", () => {
  const previous = [
    {
      title: "Type-check time (ms)",
      columns: ["Scenario", "TS 6", "TS 7"],
      rows: [
        ["Linear: 1 type", "560", "115"],
        ["Removed scenario", "1", "2"],
      ],
    },
    { title: "Removed table", columns: ["Scenario", "TS 6"], rows: [["Linear: 1 type", "1"]] },
  ];

  test("keeps the earlier value of each cell the run did not measure", () => {
    expect(
      mergeResultsTables(previous, [
        {
          title: "Type-check time (ms)",
          columns: ["Scenario", "TS 6", "TS 7"],
          rows: [["Linear: 1 type", "-", "120"]],
        },
      ]),
    ).toEqual([
      {
        title: "Type-check time (ms)",
        columns: ["Scenario", "TS 6", "TS 7"],
        rows: [["Linear: 1 type", "560", "120"]],
      },
    ]);
  });

  test("takes the layout from the run, matching earlier cells by row and column label", () => {
    expect(
      mergeResultsTables(previous, [
        {
          title: "Type-check time (ms)",
          columns: ["Scenario", "TS 7", "tsrs", "TS 6"],
          rows: [
            ["Linear: 10 types", "-", "71", "-"],
            ["Linear: 1 type", "-", "72", "-"],
          ],
        },
      ]),
    ).toEqual([
      {
        title: "Type-check time (ms)",
        columns: ["Scenario", "TS 7", "tsrs", "TS 6"],
        rows: [
          ["Linear: 10 types", "-", "71", "-"],
          ["Linear: 1 type", "115", "72", "560"],
        ],
      },
    ]);
  });
});
