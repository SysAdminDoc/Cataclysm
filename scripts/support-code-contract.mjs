import { readFileSync } from "node:fs";
import path from "node:path";

export function validateSupportCodeContract(root) {
  const failures = [];
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const supportConfig = JSON.parse(readFileSync(path.join(root, "tsconfig.support.json"), "utf8"));
  const playwrightConfig = readFileSync(path.join(root, "playwright.config.ts"), "utf8");
  const eslintConfig = readFileSync(path.join(root, "eslint.config.js"), "utf8");
  const scripts = packageJson.scripts ?? {};

  const requireScriptFragments = (name, fragments) => {
    const command = scripts[name];
    if (typeof command !== "string") {
      failures.push(`package.json is missing the ${name} script`);
      return;
    }
    for (const fragment of fragments) {
      if (!command.includes(fragment)) failures.push(`${name} does not cover ${fragment}`);
    }
  };

  requireScriptFragments("typecheck", ["tsc --noEmit", "tsconfig.support.json", "check-javascript.mjs"]);
  requireScriptFragments("lint", ["src", "tests", "scripts", "playwright.config.ts", "vite.config.ts"]);
  requireScriptFragments("test:e2e", ["run-e2e.mjs"]);
  requireScriptFragments("build", ["write-e2e-artifact.mjs", "build-pwa.mjs"]);

  const includes = new Set(supportConfig.include ?? []);
  for (const required of ["playwright.config.ts", "vite.config.ts", "tests/**/*.ts"]) {
    if (!includes.has(required)) failures.push(`tsconfig.support.json does not include ${required}`);
  }
  if (supportConfig.compilerOptions?.strict !== true || supportConfig.compilerOptions?.noEmit !== true) {
    failures.push("tsconfig.support.json must remain strict and no-emit");
  }
  if (!playwrightConfig.includes("node scripts/serve-e2e-preview.mjs")) {
    failures.push("Playwright webServer does not enforce the fresh-artifact preview contract");
  }
  if (eslintConfig.includes('"*.config.*"')) {
    failures.push("ESLint must not ignore root configuration files");
  }

  const buildCommand = scripts.build ?? "";
  if (buildCommand.indexOf("write-e2e-artifact.mjs") > buildCommand.indexOf("build-pwa.mjs")) {
    failures.push("build provenance must be written before PWA precache generation");
  }

  return { ok: failures.length === 0, failures };
}
