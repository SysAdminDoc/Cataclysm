import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const FULL_GIT_SHA_RE = /^[0-9a-f]{40}$/i;
const EXACT_CARGO_VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function usesValue(line) {
  const match = line.match(/^\s*(?:-\s*)?uses:\s*(.*?)\s*$/);
  if (!match) return null;
  return unquote(match[1].replace(/\s+#.*$/, ""));
}

function argumentValue(command, flag) {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = command.match(new RegExp(`(?:^|\\s)${escaped}(?:=|\\s+)([^\\s}]+)`, "i"));
  return match ? unquote(match[1]) : null;
}

export function workflowSupplyChainFailures(workflows) {
  const entries = Object.entries(workflows ?? {});
  if (entries.length === 0) return [".github/workflows: no workflow files found"];

  const failures = [];
  for (const [fileName, text] of entries) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const action = usesValue(line);
      if (action !== null) {
        const revision = action.slice(action.lastIndexOf("@") + 1);
        if (!action.includes("@") || !FULL_GIT_SHA_RE.test(revision)) {
          failures.push(
            `${fileName}:${lineNumber}: uses must be pinned to a full 40-hex commit SHA (${action})`,
          );
        }
      }

      if (line.trimStart().startsWith("#")) return;
      const installPattern = /\bcargo(?:\.exe)?\s+install\b([^;&|}]*)/gi;
      for (const install of line.matchAll(installPattern)) {
        const command = `cargo install${install[1]}`.trim();
        if (/(?:^|\s)--list(?:\s|$)/i.test(command)) continue;
        if (/(?:^|\s)--path(?:=|\s+)/i.test(command)) continue;

        if (/(?:^|\s)--git(?:=|\s+)/i.test(command)) {
          const revision = argumentValue(command, "--rev");
          if (!revision || !FULL_GIT_SHA_RE.test(revision)) {
            failures.push(
              `${fileName}:${lineNumber}: cargo --git install must use --rev with a full 40-hex commit SHA (${command})`,
            );
          }
          continue;
        }

        const version = argumentValue(command, "--version");
        const inlineVersion = command.match(
          /\bcargo\s+install\s+[A-Za-z0-9_-]+@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/i,
        )?.[1];
        if (
          (!version || !EXACT_CARGO_VERSION_RE.test(version)) &&
          (!inlineVersion || !EXACT_CARGO_VERSION_RE.test(inlineVersion))
        ) {
          failures.push(
            `${fileName}:${lineNumber}: cargo install must use an exact --version (${command})`,
          );
        }
      }
    });
  }
  return failures;
}

export function readWorkflowFiles(workflowRoot) {
  return Object.fromEntries(
    readdirSync(workflowRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map((entry) => [entry.name, readFileSync(path.join(workflowRoot, entry.name), "utf8")]),
  );
}
