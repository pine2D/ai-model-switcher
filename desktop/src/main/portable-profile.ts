import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import type { RuntimeInfo } from "../shared/runtime";

export interface RuntimeProfile extends RuntimeInfo {
  readonly userDataPath: string;
  readonly portableRoot?: string;
  readonly legacyUserDataPath?: string;
}

interface ResolveRuntimeProfileInput {
  readonly isPackaged: boolean;
  readonly execPath: string;
  readonly defaultUserDataPath: string;
  readonly version: string;
  readonly markerExists?: (path: string) => boolean;
}

const DATA_MARKER = ".polyask-data-v1";
const IMPORT_STAGING = ".polyask-import-v1";
const IMPORT_IDENTITY_MARKER = ".polyask-import-identity-v1";
const BOOTSTRAP_MARKER = ".polyask-bootstrap-v1";
const LEGACY_DATA_ENTRIES = ["polyask.sqlite", "Local State", "Partitions", "Default"] as const;
type PathExists = (path: string) => boolean;

export function resolveRuntimeProfile(input: ResolveRuntimeProfileInput): RuntimeProfile {
  const portableRoot = dirname(dirname(input.execPath));
  const portable = input.isPackaged && (input.markerExists ?? markerExists)(join(portableRoot, "portable.json"));
  if (!portable) {
    return { distribution: "installed", version: input.version, userDataPath: input.defaultUserDataPath };
  }
  return {
    distribution: "portable",
    version: input.version,
    portableRoot,
    userDataPath: join(portableRoot, "PolyAsk Data"),
    legacyUserDataPath: input.defaultUserDataPath
  };
}

export function isPortableDataInitialized(
  profile: RuntimeProfile,
  exists: PathExists = markerExists
): boolean {
  return profile.distribution === "portable" && exists(join(profile.userDataPath, DATA_MARKER));
}

export function hasImportableLegacyData(
  profile: RuntimeProfile,
  exists: PathExists = pathExists
): boolean {
  if (profile.distribution !== "portable" || !profile.legacyUserDataPath) return false;
  return LEGACY_DATA_ENTRIES.some((entry) => exists(join(profile.legacyUserDataPath!, entry)));
}

export function applyPortableImportIdentity(
  profile: RuntimeProfile,
  writeDeviceId: (deviceId: string) => void
): boolean {
  if (profile.distribution !== "portable") return false;
  const marker = join(profile.userDataPath, IMPORT_IDENTITY_MARKER);
  let deviceId: string;
  try { deviceId = readFileSync(marker, "utf8").trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
    throw new Error("portable_import_failed");
  }
  writeDeviceId(deviceId);
  rmSync(marker, { force: true });
  return true;
}

export async function initializePortableData(
  profile: RuntimeProfile,
  chooseImport: () => Promise<boolean>,
  legacyDataAvailable = hasImportableLegacyData(profile)
): Promise<"ready" | "fresh" | "import_staged"> {
  if (profile.distribution !== "portable" || !profile.legacyUserDataPath) return "ready";
  if (!profile.portableRoot) throw new Error("portable_root_missing");
  const staging = join(profile.portableRoot, IMPORT_STAGING);
  await mkdir(profile.userDataPath, { recursive: true });
  if (await markerFileExists(join(profile.userDataPath, DATA_MARKER))) return "ready";
  const bootstrap = await ensureBootstrapDirectory(profile.userDataPath);

  const source = profile.legacyUserDataPath;
  const canImport = source !== profile.userDataPath && legacyDataAvailable;
  if (!canImport || !await chooseImport()) {
    await rm(staging, { recursive: true, force: true });
    await writeFile(join(profile.userDataPath, DATA_MARKER), "1\n");
    await rm(join(profile.userDataPath, BOOTSTRAP_MARKER), { force: true });
    return "fresh";
  }

  try {
    await rm(staging, { recursive: true, force: true });
    await cp(source, staging, {
      recursive: true,
      force: true,
      filter: (path) => {
        const sourceRelativePath = relative(source, path);
        if (!sourceRelativePath || sourceRelativePath.includes(sep)) return true;
        return sourceRelativePath !== "lockfile"
          && sourceRelativePath !== DATA_MARKER
          && sourceRelativePath !== BOOTSTRAP_MARKER
          && sourceRelativePath !== IMPORT_IDENTITY_MARKER
          && !sourceRelativePath.startsWith("Singleton");
      }
    });
    await writeFile(join(staging, BOOTSTRAP_MARKER), `${bootstrap}\n`);
    await writeFile(join(staging, IMPORT_IDENTITY_MARKER), `${randomUUID()}\n`);
    await writeFile(join(staging, DATA_MARKER), "1\n");
    return "import_staged";
  } catch (cause) {
    if ((cause as { message?: string }).message === "portable_data_unrecognized") throw cause;
    throw Object.assign(new Error("portable_import_failed"), { cause });
  }
}

export function finalizePortableDataImport(profile: RuntimeProfile): boolean {
  if (profile.distribution !== "portable" || !profile.portableRoot) return false;
  const staging = join(profile.portableRoot, IMPORT_STAGING);
  if (!markerExists(join(staging, DATA_MARKER))) return false;
  try {
    if (markerExists(join(profile.userDataPath, DATA_MARKER))) {
      rmSync(staging, { recursive: true, force: true });
      return false;
    }
    if (pathExists(profile.userDataPath)) {
      const targetBootstrap = readBootstrap(join(profile.userDataPath, BOOTSTRAP_MARKER));
      const stagingBootstrap = readBootstrap(join(staging, BOOTSTRAP_MARKER));
      const entries = readdirSync(profile.userDataPath);
      if (!targetBootstrap || targetBootstrap !== stagingBootstrap
        || entries.some((entry) => !isImportFinalizationEntry(entry))) {
        throw new Error("portable_data_unrecognized");
      }
    }
    rmSync(profile.userDataPath, { recursive: true, force: true });
    renameSync(staging, profile.userDataPath);
    return true;
  } catch (cause) {
    if ((cause as { message?: string }).message === "portable_data_unrecognized") throw cause;
    throw Object.assign(new Error("portable_import_failed"), { cause });
  }
}

async function ensureBootstrapDirectory(path: string): Promise<string> {
  const marker = join(path, BOOTSTRAP_MARKER);
  const existing = await readBootstrapAsync(marker);
  const entries = await readdir(path);
  const unknown = entries.filter((entry) => !isBootstrapRuntimeEntry(entry));
  if (unknown.length || (existing && !entries.includes(BOOTSTRAP_MARKER))) {
    throw new Error("portable_data_unrecognized");
  }
  if (existing) return existing;
  const bootstrap = randomUUID();
  await writeFile(marker, `${bootstrap}\n`);
  return bootstrap;
}

function isBootstrapRuntimeEntry(entry: string): boolean {
  return entry === BOOTSTRAP_MARKER || entry === "Crashpad"
    || entry === "lockfile" || entry.startsWith("Singleton");
}

function isImportFinalizationEntry(entry: string): boolean {
  return entry === "Local State" || isBootstrapRuntimeEntry(entry);
}

function markerExists(path: string): boolean {
  try {
    if (!statSync(path).isFile()) throw new Error("portable_data_unrecognized");
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function pathExists(path: string): boolean {
  try { statSync(path); return true; }
  catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function markerFileExists(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("portable_data_unrecognized");
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function readBootstrap(path: string): string | null {
  try { return validBootstrap(readFileSync(path, "utf8")); }
  catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function readBootstrapAsync(path: string): Promise<string | null> {
  try { return validBootstrap(await readFile(path, "utf8")); }
  catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function validBootstrap(value: string): string {
  const id = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("portable_data_unrecognized");
  }
  return id;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
