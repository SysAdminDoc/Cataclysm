import path from "node:path";

const PACKAGE_SUFFIXES_BY_BUNDLE_KIND = Object.freeze({
  appimage: Object.freeze([".appimage", ".appimage.tar.gz"]),
  deb: Object.freeze([".deb"]),
  dmg: Object.freeze([".dmg"]),
  macos: Object.freeze([".app.tar.gz"]),
  msi: Object.freeze([".msi"]),
  nsis: Object.freeze([".exe", ".nsis.zip"]),
  rpm: Object.freeze([".rpm"]),
});

function normalizeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return null;
  }
  return normalized;
}

export function isReleaseArtifactPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length !== 2) return false;

  const [bundleKind, fileName] = segments;
  const suffixes = PACKAGE_SUFFIXES_BY_BUNDLE_KIND[bundleKind.toLowerCase()];
  if (!suffixes) return false;
  const lowerName = fileName.toLowerCase();
  return suffixes.some((suffix) => lowerName.endsWith(suffix));
}

export function selectReleaseArtifactFiles(files, bundleRoot) {
  const root = path.resolve(bundleRoot);
  return files
    .filter((file) => {
      const relative = path.relative(root, path.resolve(file));
      if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return false;
      }
      return isReleaseArtifactPath(relative);
    })
    .sort((left, right) => {
      const leftRelative = path.relative(root, left).replaceAll("\\", "/");
      const rightRelative = path.relative(root, right).replaceAll("\\", "/");
      return leftRelative.localeCompare(rightRelative, "en");
    });
}
