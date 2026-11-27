/** The databases a lesson runs on in the browser, labelled as the install picker labels them. */
export const tutorialDatabases = [
  { id: "postgres", label: "PostgreSQL" },
  { id: "sqlite", label: "SQLite" },
] as const;

export type TutorialDatabase = (typeof tutorialDatabases)[number]["id"];

/** The lesson file that opens the picked database; every lesson imports it. */
export const databaseFile = "db.ts";

/** The picked database for a label stored under the install picker's `state` key. */
export const databaseOfLabel = (label: string | undefined): TutorialDatabase =>
  tutorialDatabases.find((database) => database.label === label)?.id ?? "postgres";
