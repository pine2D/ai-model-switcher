import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ID = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;
const TARGETS = Object.freeze({
  win32: { label: "windows", extension: ".exe", matches: (name) => name.toLowerCase().endsWith(" setup.exe") },
  linux: { label: "linux", extension: ".deb", matches: (name, version) => name.endsWith(".deb") && name.includes(`_${version}_`) },
  darwin: { label: "macos", extension: ".zip", matches: (name, version) => name.endsWith(".zip") && name.includes(`-${version}`) }
});

async function filesBelow(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function verifyOAuthResource(outDir, platform, arch) {
  const suffix = `-${platform}-${arch}`;
  const candidates = (await readdir(outDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
  let valid = 0;
  for (const candidate of candidates) {
    try {
      const packageRoot = join(outDir, candidate.name);
      const resource = platform === "darwin"
        ? join(packageRoot, "PolyAsk.app", "Contents", "Resources", "oauth.json")
        : join(packageRoot, "resources", "oauth.json");
      const parsed = JSON.parse(await readFile(resource, "utf8"));
      if (typeof parsed.clientId === "string" && CLIENT_ID.test(parsed.clientId.trim())) valid += 1;
    } catch { /* This package candidate has no usable OAuth resource. */ }
  }
  if (valid !== 1) throw new Error("oauth_not_packaged");
}

export async function collectReleaseArtifact(input) {
  const target = TARGETS[input.platform];
  if (!target || !/^(x64|arm64)$/.test(input.arch) || !/^\d+\.\d+\.\d+$/.test(input.version)) {
    throw new Error("invalid_release_target");
  }
  await verifyOAuthResource(input.outDir, input.platform, input.arch);
  const matches = (await filesBelow(join(input.outDir, "make")))
    .filter((path) => target.matches(basename(path), input.version));
  if (matches.length !== 1) throw new Error(`release_artifact_count:${matches.length}`);

  await mkdir(input.outputDir, { recursive: true });
  const name = `polyask-desktop-v${input.version}-${target.label}-${input.arch}${target.extension}`;
  const path = join(input.outputDir, name);
  await copyFile(matches[0], path);
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  await writeFile(`${path}.sha256`, `${digest}  ${name}\n`);
  return { name, path };
}

async function main() {
  const [platform, arch] = process.argv.slice(2);
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const output = await collectReleaseArtifact({
    platform,
    arch,
    version: packageJson.version,
    outDir: join(desktopRoot, "out"),
    outputDir: join(desktopRoot, "release")
  });
  process.stdout.write(`${output.path}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
