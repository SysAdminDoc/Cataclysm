const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_TARGETS = new Set(["all", "windows", "macos", "linux", "ios", "android"]);

export function warningEntries(report) {
  return Object.entries(report.warnings ?? {}).flatMap(([kind, warnings]) =>
    (warnings ?? []).map((warning) => ({
      kind,
      advisory: warning.advisory.id,
      package: warning.package.name,
      version: warning.package.version,
    })),
  );
}

export function advisoryKey(entry) {
  return `${entry.advisory}|${entry.kind}|${entry.package}|${entry.version}`;
}

function packageName(metadata, id) {
  return metadata.packages.find((candidate) => candidate.id === id)?.name;
}

function pathExists(metadata, names, targetPackage, targetVersion) {
  if (!metadata.resolve?.root || names.length < 2) return false;
  if (packageName(metadata, metadata.resolve.root) !== names[0]) return false;
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  let candidates = new Set([metadata.resolve.root]);
  for (const name of names.slice(1)) {
    const next = new Set();
    for (const id of candidates) {
      for (const dependency of nodes.get(id)?.deps ?? []) {
        if (packageName(metadata, dependency.pkg) === name) next.add(dependency.pkg);
      }
    }
    if (next.size === 0) return false;
    candidates = next;
  }
  return [...candidates].some((id) => {
    const pkg = metadata.packages.find((candidate) => candidate.id === id);
    return pkg?.name === targetPackage && pkg.version === targetVersion;
  });
}

export function validateAdvisoryBaseline(baseline, report, metadata, currentDate) {
  const failures = [];
  if (baseline.schema_version !== 1) failures.push("unsupported advisory baseline schema");
  if (!DATE_PATTERN.test(currentDate)) failures.push(`invalid verification date ${currentDate}`);
  if (report.vulnerabilities?.found || report.vulnerabilities?.count > 0) {
    failures.push("cargo audit found a vulnerability; warning exceptions cannot suppress vulnerabilities");
  }

  const actual = warningEntries(report);
  const actualKeys = new Set(actual.map(advisoryKey));
  const baselineKeys = new Set();
  for (const entry of baseline.exceptions ?? []) {
    const key = advisoryKey(entry);
    if (baselineKeys.has(key)) failures.push(`duplicate exception ${key}`);
    baselineKeys.add(key);
    if (!entry.owner?.trim()) failures.push(`${key}: owner is required`);
    if (!entry.rationale?.trim()) failures.push(`${key}: rationale is required`);
    if (!/^https:\/\//.test(entry.upstream_issue ?? "")) {
      failures.push(`${key}: HTTPS upstream_issue is required`);
    }
    if (!DATE_PATTERN.test(entry.review_by ?? "")) {
      failures.push(`${key}: review_by must be YYYY-MM-DD`);
    } else if (entry.review_by < currentDate) {
      failures.push(`${key}: exception expired on ${entry.review_by}`);
    }
    if (!Array.isArray(entry.affected_targets) || entry.affected_targets.length === 0
      || entry.affected_targets.some((target) => !ALLOWED_TARGETS.has(target))) {
      failures.push(`${key}: affected_targets are missing or invalid`);
    }
    if (!Array.isArray(entry.dependency_path)
      || !pathExists(metadata, entry.dependency_path, entry.package, entry.version)) {
      failures.push(`${key}: dependency_path no longer exists in Cargo metadata`);
    }
    if (!actualKeys.has(key)) failures.push(`${key}: stale exception; warning disappeared or changed`);
  }

  for (const entry of actual) {
    const key = advisoryKey(entry);
    if (!baselineKeys.has(key)) failures.push(`${key}: new warning has no reviewed exception`);
  }
  return failures;
}
