/**
 * Job Populator
 *
 * Populates the shared SQLite database for the dashboard to display
 *
 * Then open http://localhost:3333 to view results in the dashboard.
 */

import { stateAdapter, client, db, withTransaction } from "./common.ts";
import { populateScenarios } from "./scenarios.ts";

db.exec("DELETE FROM queuert_job_blocker; DELETE FROM queuert_job; DELETE FROM queuert_worker;");

console.log("\n=== Dashboard Job Populator ===\n");

await populateScenarios({ client, stateAdapter, withTransaction });

console.log("Done!");
