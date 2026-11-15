export type ResultsTable = { title: string; columns: string[]; rows: string[][] };

export const notMeasured = "-";

const renderTable = ({ title, columns, rows }: ResultsTable): string => {
  const widths = columns.map((column, index) =>
    Math.max(3, column.length, ...rows.map((row) => row[index].length)),
  );
  const renderRow = (cells: string[]) =>
    `| ${cells.map((cell, index) => (index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index]))).join(" | ")} |`;
  const separator = `| ${widths.map((width, index) => (index === 0 ? "-".repeat(width) : `${"-".repeat(width - 1)}:`)).join(" | ")} |`;
  return [`## ${title}`, "", renderRow(columns), separator, ...rows.map(renderRow)].join("\n");
};

export const renderResultsFile = ({
  title,
  run,
  tables,
}: {
  title: string;
  run: string;
  tables: ResultsTable[];
}): string => `${[`# ${title}`, run, ...tables.map(renderTable)].join("\n\n")}\n`;

const cellsOf = (line: string): string[] =>
  line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());

export const parseResultsFile = (markdown: string): ResultsTable[] => {
  const tables: ResultsTable[] = [];
  let title: string | undefined;
  let lines: string[] = [];
  const closeTable = () => {
    if (title !== undefined && lines.length > 0) {
      const [header, , ...rows] = lines;
      tables.push({ title, columns: cellsOf(header), rows: rows.map(cellsOf) });
    }
    lines = [];
  };
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      closeTable();
      title = line.slice(3).trim();
    } else if (line.startsWith("|")) {
      lines.push(line.trim());
    } else {
      closeTable();
    }
  }
  closeTable();
  return tables;
};

export const mergeResultsTables = (
  previous: ResultsTable[],
  next: ResultsTable[],
): ResultsTable[] =>
  next.map((table) => {
    const earlier = previous.find((candidate) => candidate.title === table.title);
    return {
      ...table,
      rows: table.rows.map(([label, ...cells]) => {
        const earlierRow = earlier?.rows.find((row) => row[0] === label);
        return [
          label,
          ...cells.map((cell, index) => {
            if (cell !== notMeasured || earlier === undefined || earlierRow === undefined) {
              return cell;
            }
            const earlierIndex = earlier.columns.indexOf(table.columns[index + 1]);
            return earlierIndex > 0 ? earlierRow[earlierIndex] : notMeasured;
          }),
        ];
      }),
    };
  });
