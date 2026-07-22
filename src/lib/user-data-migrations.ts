/**
 * Append-only migration registry for user-owned JSON data.
 *
 * Never edit or remove a shipped step: add the next contiguous version pair.
 * Persistence adapters remain responsible for validating the migrated shape
 * and committing it atomically only after every step succeeds.
 */

export type UserDataDomain = "settings" | "savedScenarios" | "runArchive";

export type UserDataMigration = Readonly<{
  domain: UserDataDomain;
  fromVersion: number;
  toVersion: number;
  description: string;
  migrate: (data: unknown) => unknown;
}>;

export type UserDataMigrationResult<T> = Readonly<{
  data: T;
  schemaVersion: number;
  migrations: readonly Pick<UserDataMigration, "fromVersion" | "toVersion" | "description">[];
}>;

const CURRENT_VERSIONS = {
  settings: 6,
  savedScenarios: 1,
  runArchive: 1,
} as const satisfies Record<UserDataDomain, number>;

export class UserDataMigrationError extends Error {
  readonly domain: UserDataDomain;
  readonly storedVersion: number | null;
  readonly supportedVersion: number;
  readonly recoverable = true;

  constructor(domain: UserDataDomain, storedVersion: number | null, supportedVersion: number, detail: string) {
    super(
      `${domain} data cannot be opened safely: ${detail} `
      + `The original data was left unchanged; update Cataclysm or reset only this data set to recover.`,
    );
    this.name = "UserDataMigrationError";
    this.domain = domain;
    this.storedVersion = storedVersion;
    this.supportedVersion = supportedVersion;
  }
}

function cloneJsonData<T>(value: T): T {
  return structuredClone(value);
}

function requireRecord(domain: UserDataDomain, data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new UserDataMigrationError(
      domain,
      null,
      CURRENT_VERSIONS[domain],
      "the stored payload is not a JSON object.",
    );
  }
  return data as Record<string, unknown>;
}

function addDefault(key: string, value: unknown): (data: unknown) => unknown {
  return (data) => {
    const record = requireRecord("settings", data);
    return Object.hasOwn(record, key) ? { ...record } : { ...record, [key]: cloneJsonData(value) };
  };
}

/** Ordered, append-only registry. Descriptions are surfaced by tests and diagnostics. */
export const USER_DATA_MIGRATIONS: readonly UserDataMigration[] = Object.freeze([
  {
    domain: "settings",
    fromVersion: 1,
    toVersion: 2,
    description: "add adaptive renderer quality defaults",
    migrate: (data) => addDefault("renderer_auto_quality", true)(addDefault("renderer_quality", "High")(data)),
  },
  {
    domain: "settings",
    fromVersion: 2,
    toVersion: 3,
    description: "add launch experience preferences",
    migrate: (data) => addDefault("launch_experience_seen_at", null)(addDefault("launch_experience_policy", "first")(data)),
  },
  {
    domain: "settings",
    fromVersion: 3,
    toVersion: 4,
    description: "add progressive workspace mode",
    migrate: addDefault("workspace_mode", "simple"),
  },
  {
    domain: "settings",
    fromVersion: 4,
    toVersion: 5,
    description: "add locale preference",
    migrate: addDefault("locale", "en"),
  },
  {
    domain: "settings",
    fromVersion: 5,
    toVersion: 6,
    description: "add unit-system preference",
    migrate: addDefault("units", "metric"),
  },
  {
    domain: "savedScenarios",
    fromVersion: 0,
    toVersion: 1,
    description: "wrap the legacy scenario list in a versioned envelope",
    migrate: (data) => ({ items: cloneJsonData(data) }),
  },
  {
    domain: "runArchive",
    fromVersion: 0,
    toVersion: 1,
    description: "wrap the legacy run-record list in a versioned envelope",
    migrate: (data) => ({ records: cloneJsonData(data) }),
  },
]);

for (const domain of Object.keys(CURRENT_VERSIONS) as UserDataDomain[]) {
  const steps = USER_DATA_MIGRATIONS.filter((migration) => migration.domain === domain);
  const keys = new Set<string>();
  for (const step of steps) {
    const key = `${step.fromVersion}:${step.toVersion}`;
    if (step.toVersion !== step.fromVersion + 1 || keys.has(key)) {
      throw new Error(`Invalid ${domain} migration registry step ${key}.`);
    }
    keys.add(key);
  }
}

export function currentUserDataSchemaVersion(domain: UserDataDomain): number {
  return CURRENT_VERSIONS[domain];
}

export function migrateUserData<T = unknown>(
  domain: UserDataDomain,
  storedVersion: number,
  data: unknown,
): UserDataMigrationResult<T> {
  const supportedVersion = CURRENT_VERSIONS[domain];
  if (!Number.isInteger(storedVersion) || storedVersion < 0) {
    throw new UserDataMigrationError(domain, null, supportedVersion, "the schema version is missing or invalid.");
  }
  if (storedVersion > supportedVersion) {
    throw new UserDataMigrationError(
      domain,
      storedVersion,
      supportedVersion,
      `schema ${storedVersion} is newer than supported schema ${supportedVersion}.`,
    );
  }

  let version = storedVersion;
  let migrated = cloneJsonData(data);
  const applied: Array<Pick<UserDataMigration, "fromVersion" | "toVersion" | "description">> = [];
  while (version < supportedVersion) {
    const step = USER_DATA_MIGRATIONS.find(
      (candidate) => candidate.domain === domain && candidate.fromVersion === version,
    );
    if (!step) {
      throw new UserDataMigrationError(
        domain,
        version,
        supportedVersion,
        `no migration path exists from schema ${version} to schema ${supportedVersion}.`,
      );
    }
    migrated = step.migrate(migrated);
    version = step.toVersion;
    applied.push({
      fromVersion: step.fromVersion,
      toVersion: step.toVersion,
      description: step.description,
    });
  }

  return { data: migrated as T, schemaVersion: version, migrations: applied };
}

export function migrateSettingsData(
  storedVersion: number,
  data: unknown,
): UserDataMigrationResult<Record<string, unknown>> {
  const record = requireRecord("settings", data);
  return migrateUserData("settings", storedVersion, record);
}

export function migrateSavedScenariosData(
  raw: unknown,
): UserDataMigrationResult<{ items: unknown }> {
  if (Array.isArray(raw)) return migrateUserData("savedScenarios", 0, raw);
  const envelope = requireRecord("savedScenarios", raw);
  const version = envelope.schemaVersion;
  if (!Number.isInteger(version)) {
    throw new UserDataMigrationError(
      "savedScenarios",
      null,
      CURRENT_VERSIONS.savedScenarios,
      "the schema version is missing or invalid.",
    );
  }
  return migrateUserData("savedScenarios", version as number, { items: envelope.items });
}

export function migrateRunArchiveData(
  raw: unknown,
): UserDataMigrationResult<Record<string, unknown> & { records: unknown }> {
  if (Array.isArray(raw)) return migrateUserData("runArchive", 0, raw);
  const envelope = requireRecord("runArchive", raw);
  const version = envelope.schemaVersion;
  if (!Number.isInteger(version)) {
    throw new UserDataMigrationError(
      "runArchive",
      null,
      CURRENT_VERSIONS.runArchive,
      "the schema version is missing or invalid.",
    );
  }
  const data = { ...envelope };
  delete data.schemaVersion;
  return migrateUserData("runArchive", version as number, data as Record<string, unknown> & { records: unknown });
}
