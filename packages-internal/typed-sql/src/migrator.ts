import { type TypedSqlTemplate } from "./sql.js";

export type MigrationStatement = {
  sql: TypedSqlTemplate;
};

export type Migration = {
  name: string;
  statements: MigrationStatement[];
  transactional: boolean;
};

export type MigrationResult = {
  skipped: string[];
  applied: string[];
  unrecognized: string[];
};

export type MigrationStore<TTxContext> = {
  runInTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  getAppliedMigrationNames: (txCtx: TTxContext | undefined) => Promise<string[]>;
  executeMigrationStatements: (
    txCtx: TTxContext | undefined,
    migration: Migration,
  ) => Promise<void>;
  recordMigration: (txCtx: TTxContext | undefined, name: string) => Promise<void>;
};

export type Migrator = {
  migrateToLatest: () => Promise<MigrationResult>;
  migrateTo: (targetName: string) => Promise<MigrationResult>;
};

const MIGRATION_NAME_PATTERN = /^\d{14}_[a-z][a-z0-9_]*$/;

const validateMigrations = (migrations: Migration[]): void => {
  for (let i = 0; i < migrations.length; i++) {
    const name = migrations[i].name;
    if (!MIGRATION_NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid migration name "${name}". Must match /^\\d{14}_[a-z][a-z0-9_]*$/ (e.g. "20240101000000_initial_schema").`,
      );
    }
    if (i > 0 && name <= migrations[i - 1].name) {
      throw new Error(
        `Migrations are not in ascending order: "${migrations[i - 1].name}" must sort before "${name}".`,
      );
    }
  }
};

export const createMigrator = <TTxContext>({
  migrations,
  store,
}: {
  migrations: Migration[];
  store: MigrationStore<TTxContext>;
}): Migrator => {
  validateMigrations(migrations);
  const knownNames = new Set(migrations.map((m) => m.name));

  const run = async (selected: Migration[]): Promise<MigrationResult> => {
    const previouslyApplied = await store.runInTransaction(store.getAppliedMigrationNames);
    const previouslyAppliedSet = new Set(previouslyApplied);

    const skipped = previouslyApplied.filter((name) => knownNames.has(name));
    const unrecognized = previouslyApplied.filter((name) => !knownNames.has(name));
    const pending = selected.filter((m) => !previouslyAppliedSet.has(m.name));
    const applied: string[] = [];

    for (const migration of pending) {
      if (migration.transactional) {
        await store.runInTransaction(async (txCtx) => {
          await store.executeMigrationStatements(txCtx, migration);
          await store.recordMigration(txCtx, migration.name);
        });
      } else {
        await store.executeMigrationStatements(undefined, migration);
        await store.runInTransaction(async (txCtx) => store.recordMigration(txCtx, migration.name));
      }
      applied.push(migration.name);
    }

    return { skipped, applied, unrecognized };
  };

  return {
    migrateToLatest: async () => run(migrations),
    migrateTo: async (targetName) => run(migrations.filter((m) => m.name <= targetName)),
  };
};
