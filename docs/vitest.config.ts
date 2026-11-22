import solidPlugin from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

// Specs render JSX to HTML strings, so they run in the server posture: Node, no jsdom.
export default defineConfig({ plugins: [solidPlugin()], test: { environment: "node" } });
