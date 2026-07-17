import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const INLINE_STYLE_PATTERNS = [
  ["JSX style attribute", /(?:^|[\s<])style\s*=\s*(?:\{|["'])/gm],
  ["DOM style mutation", /\.style(?:\.|\[)/g],
  ["style attribute mutation", /setAttribute\s*\(\s*["']style["']/g],
  ["cssText mutation", /\.cssText\b/g],
  ["runtime style element", /createElement\s*\(\s*["']style["']/g],
  ["runtime stylesheet rule", /\.(?:insertRule|replaceSync)\s*\(/g],
];

export function findInlineStyleViolations(source, relativePath = "source") {
  const violations = [];
  for (const [rule, pattern] of INLINE_STYLE_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push({ relativePath, line, rule, excerpt: match[0] });
    }
  }
  return violations;
}

export function scanTrackedApplicationStyles(repoRoot) {
  const result = spawnSync("git", ["ls-files", "--", "index.html", "src"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`could not inventory tracked application source: ${result.stderr.trim()}`);
  }
  const sourceExtensions = new Set([".html", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((relativePath) => sourceExtensions.has(path.extname(relativePath)))
    .flatMap((relativePath) =>
      findInlineStyleViolations(readFileSync(path.join(repoRoot, relativePath), "utf8"), relativePath),
    );
}
