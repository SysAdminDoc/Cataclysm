import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  analyzeReferenceFrame,
  createPhaseContactSheet,
  evaluateReferenceFrame,
} from "./reference-visual-quality.mjs";

function frame(width, height, paint) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = paint(x, y);
      const index = (y * width + x) * 3;
      data[index] = red;
      data[index + 1] = green;
      data[index + 2] = blue;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test("perceptual metrics accept a detailed central event", async () => {
  const control = await frame(200, 100, (x, y) => [20 + (x % 17), 55 + (y % 13), 90]);
  const event = await frame(200, 100, (x, y) => {
    if (x >= 70 && x < 130 && y >= 25 && y < 75) return [245, 185 + ((x + y) % 30), 40];
    return [20 + (x % 17), 55 + (y % 13), 90];
  });
  const metrics = await analyzeReferenceFrame(event, {
    controlImage: control,
    sampleWidth: 200,
    targetRegion: { x: 0.25, y: 0.15, width: 0.5, height: 0.7 },
  });
  const result = evaluateReferenceFrame(metrics, {
    minDynamicRange: 40,
    minEdgeEnergy: 1,
    maxFlatBlockRatio: 0.95,
    minChangedPixelRatio: 0.1,
    minMeanColorDelta: 10,
    minTargetChangeCoverage: 0.95,
  });
  assert.equal(result.passed, true, result.failures.join("\n"));
  assert.ok(metrics.changeCentroid.x > 0.45 && metrics.changeCentroid.x < 0.55);
});

test("perceptual metrics reject a flat frame and off-target change", async () => {
  const control = await frame(200, 100, () => [30, 60, 90]);
  const event = await frame(200, 100, (x, y) => (x < 20 && y < 20 ? [255, 255, 255] : [30, 60, 90]));
  const metrics = await analyzeReferenceFrame(event, {
    controlImage: control,
    sampleWidth: 200,
    targetRegion: { x: 0.25, y: 0.2, width: 0.5, height: 0.6 },
  });
  const result = evaluateReferenceFrame(metrics, {
    minDynamicRange: 20,
    minEdgeEnergy: 1,
    maxFlatBlockRatio: 0.8,
    minTargetChangeCoverage: 0.5,
  });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.startsWith("dynamicRange")));
  assert.ok(result.failures.some((failure) => failure.startsWith("targetChangeCoverage")));
});

test("contact sheet preserves all named review phases", async () => {
  const before = await frame(120, 60, () => [15, 25, 40]);
  const event = await frame(120, 60, (x) => (x > 45 && x < 75 ? [250, 140, 20] : [15, 25, 40]));
  const aftermath = await frame(120, 60, (x) => (x > 35 && x < 85 ? [80, 70, 65] : [15, 25, 40]));
  const sheet = await createPhaseContactSheet([
    { label: "Before", image: before },
    { label: "Event", image: event },
    { label: "Aftermath", image: aftermath },
  ], { panelWidth: 240, headerHeight: 32 });
  const metadata = await sharp(sheet).metadata();
  assert.equal(metadata.width, 720);
  assert.ok(metadata.height > 32);
});
