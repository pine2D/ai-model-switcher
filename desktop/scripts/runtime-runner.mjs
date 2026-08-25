import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

export const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

export function packageApplication() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", "package"], {
    cwd: desktopDirectory,
    env: process.env,
    stdio: "inherit"
  });
  if (result.status !== 0) throw new Error(`package_failed:${result.status ?? "unknown"}`);
}

export function packagedExecutablePath(platform = process.platform, arch = process.arch) {
  const base = join(
    desktopDirectory,
    "out",
    `PolyAsk-${platform}-${arch}`
  );
  if (platform === "win32") return join(base, "polyask-desktop.exe");
  if (platform === "darwin") {
    return join(base, "PolyAsk.app", "Contents", "MacOS", "polyask-desktop");
  }
  return join(base, "polyask-desktop");
}

export async function prepareRuntime(prefix, environmentForDirectory) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const userData = join(directory, "user-data");
  const environment = environmentForDirectory(directory);
  return { directory, userData, environment };
}

export async function launchRuntime(prefix, environmentForDirectory) {
  const prepared = await prepareRuntime(prefix, environmentForDirectory);
  const logs = [];
  const child = spawn(packagedExecutablePath(), [`--user-data-dir=${prepared.userData}`], {
    cwd: desktopDirectory,
    env: { ...process.env, ...prepared.environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const remember = (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 80) logs.shift();
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);
  return { ...prepared, child, logs: () => logs.join("").slice(-12_000) };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForJson(path, child, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      const text = await readFile(path, "utf8");
      const value = predicate(text);
      if (value) return value;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (child.exitCode !== null) throw new Error(`runtime_exited:${child.exitCode}`);
    await delay(200);
  }
  throw new Error(`runtime_timeout:${timeoutMs}`);
}

export async function stopRuntime(runtime) {
  const { child, directory } = runtime;
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(5_000)
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await removeRuntimeDirectory(directory);
}

export async function removeRuntimeDirectory(directory) {
  await rm(directory, { recursive: true, force: true });
}
