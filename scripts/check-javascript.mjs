import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptRoot = path.join(repoRoot, "scripts");
const supportedExtensions = new Set([".js", ".mjs", ".cjs"]);

function collectJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectJavaScriptFiles(absolute);
      return supportedExtensions.has(path.extname(entry.name)) ? [absolute] : [];
    })
    .sort();
}

const files = [path.join(repoRoot, "eslint.config.js"), ...collectJavaScriptFiles(scriptRoot)];

for (const file of files) {
  const relative = path.relative(repoRoot, file);
  const result = spawnSync(process.execPath, ["--check", relative], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `JavaScript syntax check failed: ${relative}\n`);
    process.exit(result.status ?? 1);
  }
}

console.log(`JavaScript syntax verified for ${files.length} support files.`);
