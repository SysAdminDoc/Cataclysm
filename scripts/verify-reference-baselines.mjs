import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const contract = JSON.parse(await readFile(path.join(root, "src/data/reference-scenes.json"), "utf8"));
const qualityContract = JSON.parse(await readFile(path.join(root, "src/data/reference-visual-quality.json"), "utf8"));
const baselines = JSON.parse(await readFile(path.join(root, "tests/reference-baselines.json"), "utf8"));
const fixtures = JSON.parse(await readFile(path.join(root, "src/data/direct-hazard-capture-fixtures.json"), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const failures = [];
const expectedKeys = new Set();

if (contract.scenes.length !== 12) failures.push(`expected 12 scenes, found ${contract.scenes.length}`);
if (baselines.captureContractVersion !== contract.captureContractVersion) failures.push("contract version mismatch");
if (qualityContract.schemaVersion !== 1 || qualityContract.contractVersion !== "1.0.0") {
  failures.push("visual-quality contract version mismatch");
}
const qualitySceneIds = new Set(Object.keys(qualityContract.scenes ?? {}));
for (const scene of contract.scenes) {
  const sceneSha256 = sha256(Buffer.from(JSON.stringify(scene)));
  const quality = qualityContract.scenes?.[scene.id];
  if (!quality) {
    failures.push(`${scene.id}: missing visual-quality contract`);
  } else {
    if (!quality.subject?.trim() || !quality.eventPhase?.trim() || !quality.requiredScaleCue?.trim()) {
      failures.push(`${scene.id}: visual-quality subject, phase, and scale cue are required`);
    }
    if (!Array.isArray(quality.forbiddenFailureCues) || quality.forbiddenFailureCues.length === 0) {
      failures.push(`${scene.id}: forbidden visual failure cues are required`);
    }
    if (!quality.thresholds || Object.keys(quality.thresholds).length === 0) {
      failures.push(`${scene.id}: perceptual thresholds are required`);
    }
    if (!["approved", "blocked"].includes(quality.review?.status)
      || !quality.review?.approver?.trim()
      || !quality.review?.reason?.trim()
      || !Number.isFinite(Date.parse(quality.review?.reviewedAt))) {
      failures.push(`${scene.id}: visual review must be dated, attributed, and justified`);
    }
  }
  if (scene.workflow.fixtureId && !fixtures[scene.workflow.fixtureId]) failures.push(`${scene.id}: missing Rust fixture`);
  for (const [resolution, viewport] of Object.entries(contract.viewports)) {
    const key = `${scene.id}@${resolution}`;
    expectedKeys.add(key);
    const baseline = baselines.entries[key];
    if (!baseline) {
      failures.push(`${key}: missing baseline lock`);
      continue;
    }
    if (baseline.sceneSha256 !== sceneSha256) failures.push(`${key}: scene contract hash drift`);
    if (!/^[a-f0-9]{64}$/.test(baseline.pngSha256)) failures.push(`${key}: invalid PNG hash`);
    if (baseline.width !== viewport.width || baseline.height !== viewport.height) failures.push(`${key}: dimensions drift`);
  }
}
for (const sceneId of qualitySceneIds) {
  if (!contract.scenes.some((scene) => scene.id === sceneId)) failures.push(`${sceneId}: orphaned visual-quality contract`);
}
for (const key of Object.keys(baselines.entries)) {
  if (!expectedKeys.has(key)) failures.push(`${key}: orphaned or wildcard baseline`);
}
if (expectedKeys.size !== 24 || Object.keys(baselines.entries).length !== 24) {
  failures.push(`expected exactly 24 locks, found ${Object.keys(baselines.entries).length}`);
}
if (failures.length) {
  console.error("HR-00 reference baseline gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
const approvedHighlights = Object.values(qualityContract.scenes).filter((scene) => scene.review.status === "approved").length;
console.log(`HR-00 reference contract ${contract.captureContractVersion}: 12 scenes, 24 locked 1440p/4K captures, ${approvedHighlights} highlight-eligible review(s).`);
