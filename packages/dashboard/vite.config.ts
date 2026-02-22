import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { type Plugin, defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function collectFiles(
  dir: string,
  base = dir,
): { path: string; content: string; contentType: string }[] {
  const entries: { path: string; content: string; contentType: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...collectFiles(fullPath, base));
    } else {
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      entries.push({
        path: "/" + relative(base, fullPath),
        content: readFileSync(fullPath, "utf-8"),
        contentType: contentTypes[ext] ?? "application/octet-stream",
      });
    }
  }
  return entries;
}

function embedAssetsPlugin(): Plugin {
  const distDir = resolve(__dirname, "dist/frontend");
  const outFile = resolve(__dirname, "src/api/routes/assets.generated.ts");

  return {
    name: "embed-assets",
    closeBundle() {
      const files = collectFiles(distDir);

      let code = "// Auto-generated — do not edit\n";
      code += "export const assets: Record<string, { content: string; contentType: string }> = {\n";
      for (const file of files) {
        const escaped = file.content
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/\$/g, "\\$");
        code += `  ${JSON.stringify(file.path)}: {\n`;
        code += `    content: \`${escaped}\`,\n`;
        code += `    contentType: ${JSON.stringify(file.contentType)},\n`;
        code += `  },\n`;
      }
      code += "};\n";

      writeFileSync(outFile, code);
      console.log(`Embedded ${files.length} assets into ${outFile}`);
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), embedAssetsPlugin()],
  root: resolve(__dirname, "src/frontend"),
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist/frontend"),
    emptyOutDir: true,
  },
});
