import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const root = process.cwd();
const sourcePath = path.join(root, "artifacts", "visual-reference", "latest", "orbit-global@1440p.png");
const sourceMetadataPath = path.join(root, "artifacts", "visual-reference", "latest", "orbit-global@1440p.json");
const baselinePath = path.join(root, "tests", "reference-baselines.json");
const qualityPath = path.join(root, "src", "data", "reference-visual-quality.json");
const manifestPath = path.join(root, "src", "data", "scenario-thumbnail-manifest.json");
const outputDir = path.join(root, "public", "scenario-thumbnails");
const checkOnly = process.argv.includes("--check");

const variants = [
  { id: "earth-global", file: "earth-global.webp", position: "centre" },
  { id: "earth-ocean", file: "earth-ocean.webp", position: "west" },
  { id: "earth-limb", file: "earth-limb.webp", position: "east" },
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function verifyGovernance(manifest) {
  const baselines = await readJson(baselinePath);
  const quality = await readJson(qualityPath);
  const approved = baselines.entries["orbit-global@1440p"];
  const review = quality.scenes["orbit-global"]?.review;
  if (!approved || review?.status !== "approved") {
    throw new Error("Scenario thumbnails require the approved orbit-global@1440p reference capture.");
  }
  if (manifest.source.pngSha256 !== approved.pngSha256 || manifest.source.sceneSha256 !== approved.sceneSha256) {
    throw new Error("Scenario thumbnail manifest no longer matches the approved reference baseline.");
  }
  if (manifest.source.usage !== "environment-only" || !manifest.source.limitation?.trim()) {
    throw new Error("Scenario thumbnails must retain their global-Earth, non-event limitation.");
  }
}

async function checkOutputs(manifest) {
  await verifyGovernance(manifest);
  if (manifest.schemaVersion !== 1 || manifest.captureContract !== "reference-scenes@1.0.0") {
    throw new Error("Unsupported scenario thumbnail manifest.");
  }
  if (manifest.thumbnails.length !== variants.length) {
    throw new Error(`Expected ${variants.length} governed scenario thumbnails.`);
  }
  for (const variant of variants) {
    const entry = manifest.thumbnails.find((candidate) => candidate.id === variant.id);
    if (!entry || entry.file !== variant.file || entry.width !== 360 || entry.height !== 210) {
      throw new Error(`${variant.id}: missing or invalid thumbnail contract.`);
    }
    const output = await readFile(path.join(outputDir, variant.file));
    if (sha256(output) !== entry.sha256) throw new Error(`${variant.id}: generated image hash drifted.`);
    const metadata = await sharp(output).metadata();
    if (metadata.width !== 360 || metadata.height !== 210 || metadata.format !== "webp") {
      throw new Error(`${variant.id}: output must be a 360x210 WebP image.`);
    }
  }
  console.log(`verified ${manifest.thumbnails.length} governed scenario thumbnails`);
}

if (checkOnly) {
  await checkOutputs(await readJson(manifestPath));
  process.exit(0);
}

const [source, metadata, baselines, quality] = await Promise.all([
  readFile(sourcePath),
  readJson(sourceMetadataPath),
  readJson(baselinePath),
  readJson(qualityPath),
]);
const approved = baselines.entries["orbit-global@1440p"];
if (
  metadata.sceneId !== "orbit-global"
  || metadata.resolution !== "1440p"
  || metadata.visualQuality?.highlightEligible !== true
  || quality.scenes["orbit-global"]?.review?.status !== "approved"
  || sha256(source) !== approved?.pngSha256
) {
  throw new Error("Refusing to generate library art from an unapproved or drifted capture.");
}

await mkdir(outputDir, { recursive: true });
const thumbnails = [];
for (const variant of variants) {
  const output = await sharp(source)
    .resize({ width: 360, height: 210, fit: "cover", position: variant.position })
    .webp({ quality: 84, effort: 6, smartSubsample: true })
    .toBuffer();
  await writeFile(path.join(outputDir, variant.file), output);
  thumbnails.push({
    id: variant.id,
    file: variant.file,
    width: 360,
    height: 210,
    sha256: sha256(output),
  });
}

const manifest = {
  schemaVersion: 1,
  captureContract: "reference-scenes@1.0.0",
  source: {
    sceneId: "orbit-global",
    resolution: "1440p",
    pngSha256: approved.pngSha256,
    sceneSha256: approved.sceneSha256,
    usage: "environment-only",
    limitation: quality.scenes["orbit-global"].review.reason,
  },
  thumbnails,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await checkOutputs(manifest);
