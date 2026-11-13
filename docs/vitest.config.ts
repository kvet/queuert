import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// Specs run in Node, so JSX compiles for the server: no jsdom and no `browser` condition.
export default defineConfig({ plugins: [solid({ ssr: true })] });
