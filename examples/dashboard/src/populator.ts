/**
 * Job Populator
 *
 * Populates the shared SQLite database for the dashboard to display
 *
 * Then open http://localhost:3333 to view results in the dashboard.
 */

import { stateAdapter, client, withTransaction } from "./common.ts";
import { populateScenarios } from "./scenarios.ts";

await stateAdapter.truncate();

console.log("\n=== Dashboard Job Populator ===\n");

await populateScenarios({ client, stateAdapter, withTransaction });

console.log("Done!");
