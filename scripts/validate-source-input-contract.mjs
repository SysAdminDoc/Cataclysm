import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(path.join(repoRoot, "src/data/source-input-contract.json"), "utf8"));
const manual = readFileSync(path.join(repoRoot, "docs/manual/custom-scenarios.md"), "utf8");

if (contract.contractVersion !== 1 || contract.scenarioSchemaVersion !== 1) {
  throw new Error("Source input contract versions must match the supported contract and scenario schema versions.");
}

for (const [sourceName, source] of Object.entries(contract.sources)) {
  for (const [fieldName, field] of Object.entries(source.fields)) {
    if (!field.type || !field.label || !("default" in field) || !(field.applicability ?? contract.defaultApplicability)) {
      throw new Error(`${sourceName}.${fieldName} is missing type, label, default, or applicability metadata.`);
    }
    if (field.type === "enum") {
      if (!field.values.includes(field.default)) throw new Error(`${sourceName}.${fieldName} has an invalid enum default.`);
      continue;
    }
    if (!Number.isFinite(field.minimum) || !Number.isFinite(field.maximum) || field.minimum > field.maximum || field.minimumInclusive !== true || field.maximumInclusive !== true) {
      throw new Error(`${sourceName}.${fieldName} has invalid or unsupported bounds.`);
    }
    if (field.default < field.minimum || field.default > field.maximum) throw new Error(`${sourceName}.${fieldName} default is outside its bounds.`);
  }
}

const documentedRanges = [
  ["asteroid diameter", ["| Diameter (m) | 1 – 50,000 |"]],
  ["asteroid density", ["| Density (kg/m³) | 500 – 8,000 |"]],
  ["asteroid velocity", ["| Velocity (m/s) | 1,000 – 72,000 |"]],
  ["asteroid angle", ["| Impact angle (°) | 1 – 90 |", "| Angle (°) | 1 – 90 |"]],
  ["nuclear yield", ["| Yield (kt TNT) | 0.001 – 1,000,000 |"]],
  ["nuclear burst depth", ["| Burst depth (m) | 0 – 6,000 |"]],
  ["earthquake magnitude", ["| Magnitude (Mw) | 5 – 10 |", "| Magnitude (Mw) | 5.0 – 10.0 |"]],
  ["earthquake depth", ["| Hypocentre depth (m) | 0 – 100,000 |", "| Depth (m) | 0 – 100,000 |"]],
  ["earthquake strike", ["| Strike (°) | 0 – 360 |"]],
  ["earthquake dip", ["| Dip (°) | 0 – 90 |"]],
  ["earthquake rake", ["| Rake (°) | -180 – 180 |", "| Rake (°) | −180 – 180 |"]],
  ["earthquake slip", ["| Slip (m) | 0 – 100 |"]],
  ["landslide density", ["| Density (kg/m³) | 500 – 8,000 |"]],
  ["landslide drop height", ["| Drop height (m) | 0 – 10,000 |"]],
  ["landslide slope", ["| Slope (°) | 0 – 90 |"]],
];
for (const [name, alternatives] of documentedRanges) {
  if (!alternatives.some((expected) => manual.includes(expected))) throw new Error(`Manual ${name} range does not match the source input contract.`);
}

console.log(`Source input contract v${contract.contractVersion}: metadata, defaults, inclusive bounds, applicability, and manual ranges verified.`);
