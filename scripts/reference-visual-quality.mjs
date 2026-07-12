import sharp from "sharp";

const DEFAULT_REGION = Object.freeze({ x: 0.15, y: 0.15, width: 0.7, height: 0.7 });
const DEFAULT_SAMPLE_WIDTH = 320;
const DEFAULT_DIFF_THRESHOLD = 16;
const DEFAULT_FLAT_BLOCK_STD_DEV = 2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedRegion(region = DEFAULT_REGION) {
  const x = clamp(Number(region.x), 0, 1);
  const y = clamp(Number(region.y), 0, 1);
  const width = clamp(Number(region.width), 0, 1 - x);
  const height = clamp(Number(region.height), 0, 1 - y);
  if (width <= 0 || height <= 0) throw new Error("Visual-quality target region must have positive area.");
  return { x, y, width, height };
}

function pixelBounds(region, width, height) {
  const x0 = Math.floor(region.x * width);
  const y0 = Math.floor(region.y * height);
  const x1 = Math.max(x0 + 1, Math.ceil((region.x + region.width) * width));
  const y1 = Math.max(y0 + 1, Math.ceil((region.y + region.height) * height));
  return { x0, y0, x1: Math.min(width, x1), y1: Math.min(height, y1) };
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function luminance(red, green, blue) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

async function decodeForAnalysis(image, sampleWidth) {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .resize({ width: sampleWidth, withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Expected three RGB channels, received ${info.channels}.`);
  return { data, width: info.width, height: info.height };
}

function sceneMetrics(decoded, region, flatBlockStdDev) {
  const { data, width, height } = decoded;
  const bounds = pixelBounds(region, width, height);
  const values = [];
  const lum = new Float32Array(width * height);
  for (let index = 0, pixel = 0; index < data.length; index += 3, pixel += 1) {
    lum[pixel] = luminance(data[index], data[index + 1], data[index + 2]);
  }

  let edgeTotal = 0;
  let edgeSamples = 0;
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const value = lum[y * width + x];
      values.push(value);
      if (x + 1 < bounds.x1) {
        edgeTotal += Math.abs(value - lum[y * width + x + 1]);
        edgeSamples += 1;
      }
      if (y + 1 < bounds.y1) {
        edgeTotal += Math.abs(value - lum[(y + 1) * width + x]);
        edgeSamples += 1;
      }
    }
  }

  values.sort((left, right) => left - right);
  const p05 = percentile(values, 0.05);
  const p95 = percentile(values, 0.95);
  const blockSize = Math.max(4, Math.round(width / 20));
  let flatBlocks = 0;
  let blockCount = 0;
  for (let y0 = bounds.y0; y0 < bounds.y1; y0 += blockSize) {
    for (let x0 = bounds.x0; x0 < bounds.x1; x0 += blockSize) {
      const x1 = Math.min(bounds.x1, x0 + blockSize);
      const y1 = Math.min(bounds.y1, y0 + blockSize);
      let sum = 0;
      let sumSquares = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const value = lum[y * width + x];
          sum += value;
          sumSquares += value * value;
          count += 1;
        }
      }
      const mean = count > 0 ? sum / count : 0;
      const variance = count > 0 ? Math.max(0, sumSquares / count - mean * mean) : 0;
      if (Math.sqrt(variance) < flatBlockStdDev) flatBlocks += 1;
      blockCount += 1;
    }
  }

  return {
    dynamicRange: p95 - p05,
    edgeEnergy: edgeSamples > 0 ? edgeTotal / edgeSamples : 0,
    flatBlockRatio: blockCount > 0 ? flatBlocks / blockCount : 1,
  };
}

function differenceMetrics(event, control, region, threshold) {
  if (event.width !== control.width || event.height !== control.height) {
    throw new Error("Event and control frames must have matching sampled dimensions.");
  }
  const bounds = pixelBounds(region, event.width, event.height);
  let changedPixels = 0;
  let targetChangedPixels = 0;
  let deltaTotal = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightTotal = 0;
  const pixelCount = event.width * event.height;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const delta = (
      Math.abs(event.data[index] - control.data[index])
      + Math.abs(event.data[index + 1] - control.data[index + 1])
      + Math.abs(event.data[index + 2] - control.data[index + 2])
    ) / 3;
    deltaTotal += delta;
    if (delta < threshold) continue;
    const x = pixel % event.width;
    const y = Math.floor(pixel / event.width);
    changedPixels += 1;
    if (x >= bounds.x0 && x < bounds.x1 && y >= bounds.y0 && y < bounds.y1) {
      targetChangedPixels += 1;
    }
    weightedX += (x / Math.max(1, event.width - 1)) * delta;
    weightedY += (y / Math.max(1, event.height - 1)) * delta;
    weightTotal += delta;
  }

  return {
    changedPixelRatio: changedPixels / pixelCount,
    meanColorDelta: deltaTotal / pixelCount,
    targetChangeCoverage: changedPixels > 0 ? targetChangedPixels / changedPixels : 0,
    changeCentroid: weightTotal > 0
      ? { x: weightedX / weightTotal, y: weightedY / weightTotal }
      : null,
  };
}

export async function analyzeReferenceFrame(eventImage, options = {}) {
  const sampleWidth = options.sampleWidth ?? DEFAULT_SAMPLE_WIDTH;
  const diffThreshold = options.diffThreshold ?? DEFAULT_DIFF_THRESHOLD;
  const flatBlockStdDev = options.flatBlockStdDev ?? DEFAULT_FLAT_BLOCK_STD_DEV;
  const region = normalizedRegion(options.targetRegion);
  const event = await decodeForAnalysis(eventImage, sampleWidth);
  const metrics = {
    sample: { width: event.width, height: event.height },
    targetRegion: region,
    ...sceneMetrics(event, region, flatBlockStdDev),
  };
  if (options.controlImage) {
    const control = await decodeForAnalysis(options.controlImage, sampleWidth);
    Object.assign(metrics, differenceMetrics(event, control, region, diffThreshold));
  }
  return metrics;
}

const THRESHOLD_RULES = Object.freeze([
  ["minDynamicRange", "dynamicRange", (actual, expected) => actual >= expected, ">="],
  ["minEdgeEnergy", "edgeEnergy", (actual, expected) => actual >= expected, ">="],
  ["maxFlatBlockRatio", "flatBlockRatio", (actual, expected) => actual <= expected, "<="],
  ["minChangedPixelRatio", "changedPixelRatio", (actual, expected) => actual >= expected, ">="],
  ["minMeanColorDelta", "meanColorDelta", (actual, expected) => actual >= expected, ">="],
  ["minTargetChangeCoverage", "targetChangeCoverage", (actual, expected) => actual >= expected, ">="],
]);

export function evaluateReferenceFrame(metrics, thresholds) {
  const failures = [];
  for (const [thresholdName, metricName, compare, operator] of THRESHOLD_RULES) {
    const expected = thresholds?.[thresholdName];
    if (expected === undefined) continue;
    const actual = metrics[metricName];
    if (!Number.isFinite(actual)) {
      failures.push(`${metricName} was not measured`);
    } else if (!compare(actual, expected)) {
      failures.push(`${metricName} ${actual.toFixed(4)} must be ${operator} ${Number(expected).toFixed(4)}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

export async function createPhaseContactSheet(phases, options = {}) {
  if (!Array.isArray(phases) || phases.length < 2) {
    throw new Error("A visual review contact sheet requires at least two phases.");
  }
  const panelWidth = options.panelWidth ?? 720;
  const headerHeight = options.headerHeight ?? 52;
  const prepared = await Promise.all(phases.map(async ({ label, image }) => {
    const resized = await sharp(image).resize({ width: panelWidth }).png().toBuffer({ resolveWithObject: true });
    const header = Buffer.from(
      `<svg width="${panelWidth}" height="${headerHeight}"><rect width="100%" height="100%" fill="#11131d"/><text x="24" y="34" fill="#f4f6ff" font-family="Segoe UI, Arial" font-size="22" font-weight="600">${escapeXml(label)}</text></svg>`,
    );
    return sharp({
      create: {
        width: panelWidth,
        height: resized.info.height + headerHeight,
        channels: 3,
        background: "#11131d",
      },
    }).composite([
      { input: header, top: 0, left: 0 },
      { input: resized.data, top: headerHeight, left: 0 },
    ]).png().toBuffer({ resolveWithObject: true });
  }));
  const panelHeight = Math.max(...prepared.map((entry) => entry.info.height));
  return sharp({
    create: {
      width: panelWidth * prepared.length,
      height: panelHeight,
      channels: 3,
      background: "#11131d",
    },
  }).composite(prepared.map((entry, index) => ({
    input: entry.data,
    top: 0,
    left: index * panelWidth,
  }))).png().toBuffer();
}
