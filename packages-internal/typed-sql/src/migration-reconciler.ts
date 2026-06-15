export type ReconcilerRow = Record<string, unknown>;

export type CellPredicate = (
  after: unknown,
  beforeRow: Readonly<ReconcilerRow>,
  snapshot: ReadonlyMap<string, Readonly<ReconcilerRow>>,
) => boolean;

export type ColumnAdd = { column: string; derive: CellPredicate };
export type ColumnRename = { from: string; to: string };
export type InPlaceChange = { column: string; predicate: CellPredicate };

export type ColumnContract = {
  add?: ColumnAdd[];
  rename?: ColumnRename[];
  drop?: string[];
  inPlace?: InPlaceChange[];
};

export type ReconcileFailureReason =
  | "row-added"
  | "row-removed"
  | "undeclared-add"
  | "undeclared-drop"
  | "cell-changed"
  | "predicate-failed";

export type ReconcileFailure = {
  reason: ReconcileFailureReason;
  table: string;
  key: string;
  column?: string;
  expected?: unknown;
  actual?: unknown;
};

export type Reconciler = {
  reconcile: (
    migrationName: string,
    contract: ColumnContract,
    liveRows: readonly ReconcilerRow[],
  ) => void;
  projection: () => ReadonlyMap<string, Readonly<ReconcilerRow>>;
};

const canon = (value: unknown): string => {
  if (value === null || value === undefined) return "∅";
  if (value instanceof Date) return `D:${value.toISOString()}`;
  if (typeof value === "object") return `J:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value as string | number | boolean | bigint)}`;
};

const equalCell = (a: unknown, b: unknown): boolean => canon(a) === canon(b);

const MAX_REPORTED = 5;

const describeFailure = (f: ReconcileFailure): string => {
  const at = f.column ? `${f.table}.${f.column}@${f.key}` : `${f.table}@${f.key}`;
  if (f.reason === "cell-changed" || f.reason === "predicate-failed") {
    return `${at} — ${f.reason} (expected ${canon(f.expected)}, got ${canon(f.actual)})`;
  }
  return `${at} — ${f.reason}`;
};

export const createMigrationReconciler = (
  table: string,
  initialRows: readonly ReconcilerRow[],
  keyOf: (row: ReconcilerRow) => string,
): Reconciler => {
  let projection = new Map<string, ReconcilerRow>(
    initialRows.map((row) => [keyOf(row), { ...row }]),
  );

  const reconcile = (
    migrationName: string,
    contract: ColumnContract,
    liveRows: readonly ReconcilerRow[],
  ): void => {
    const snapshot: ReadonlyMap<string, Readonly<ReconcilerRow>> = projection;
    const liveByKey = new Map<string, ReconcilerRow>(liveRows.map((row) => [keyOf(row), row]));
    const failures: ReconcileFailure[] = [];
    const push = (f: ReconcileFailure): void => {
      if (failures.length < MAX_REPORTED) failures.push(f);
    };

    for (const key of liveByKey.keys()) {
      if (!snapshot.has(key)) push({ reason: "row-added", table, key });
    }
    for (const key of snapshot.keys()) {
      if (!liveByKey.has(key)) push({ reason: "row-removed", table, key });
    }

    const next = new Map<string, ReconcilerRow>();
    for (const [key, beforeRow] of snapshot) {
      const liveRow = liveByKey.get(key);
      if (liveRow === undefined) continue;

      const expected: ReconcilerRow = { ...beforeRow };
      for (const { from, to } of contract.rename ?? []) {
        expected[to] = expected[from];
        delete expected[from];
      }
      for (const column of contract.drop ?? []) {
        delete expected[column];
      }
      for (const { column, derive } of contract.add ?? []) {
        if (!derive(liveRow[column], beforeRow, snapshot)) {
          push({ reason: "predicate-failed", table, key, column, actual: liveRow[column] });
        }
        expected[column] = liveRow[column];
      }
      for (const { column, predicate } of contract.inPlace ?? []) {
        if (!predicate(liveRow[column], beforeRow, snapshot)) {
          push({
            reason: "predicate-failed",
            table,
            key,
            column,
            expected: beforeRow[column],
            actual: liveRow[column],
          });
        }
        expected[column] = liveRow[column];
      }

      for (const column of Object.keys(expected)) {
        if (!(column in liveRow)) {
          push({ reason: "undeclared-drop", table, key, column, expected: expected[column] });
          continue;
        }
        if (!equalCell(expected[column], liveRow[column])) {
          push({
            reason: "cell-changed",
            table,
            key,
            column,
            expected: expected[column],
            actual: liveRow[column],
          });
        }
      }
      for (const column of Object.keys(liveRow)) {
        if (!(column in expected)) {
          push({ reason: "undeclared-add", table, key, column, actual: liveRow[column] });
        }
      }

      next.set(key, expected);
    }

    if (failures.length > 0) {
      const more = failures.length === MAX_REPORTED ? " (and possibly more)" : "";
      throw new Error(
        `Migration "${migrationName}" diverged from its declared contract on ${table}${more}:\n` +
          failures.map((f) => `  - ${describeFailure(f)}`).join("\n"),
      );
    }

    projection = next;
  };

  return { reconcile, projection: () => projection };
};
