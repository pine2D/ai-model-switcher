import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectReleaseArtifact } from "./release-artifacts.mjs";
import * as releaseArtifacts from "./release-artifacts.mjs";

const CLIENT_ID = "test-client.apps.googleusercontent.com";

test("release artifacts are normalized, checksummed and OAuth-enabled", async () => {
  for (const item of [
    { platform: "win32", arch: "x64", source: "PolyAsk Setup.exe", target: "polyask-desktop-v0.17.0-windows-x64.exe" },
    { platform: "linux", arch: "x64", source: "polyask_0.17.0_amd64.deb", target: "polyask-desktop-v0.17.0-linux-x64.deb" },
    { platform: "darwin", arch: "arm64", source: "PolyAsk-darwin-arm64-0.17.0.zip", target: "polyask-desktop-v0.17.0-macos-arm64.zip" }
  ]) {
    const root = await mkdtemp(join(tmpdir(), "polyask-release-"));
    const makeDir = join(root, "out", "make", "target");
    const packageRoot = join(root, "out", `PolyAsk-${item.platform}-${item.arch}`);
    const packageResources = item.platform === "darwin"
      ? join(packageRoot, "PolyAsk.app", "Contents", "Resources")
      : join(packageRoot, "resources");
    const outputDir = join(root, "release");
    await mkdir(makeDir, { recursive: true });
    await mkdir(packageResources, { recursive: true });
    await writeFile(join(makeDir, item.source), "artifact");
    if (item.source.includes("0.17.0")) {
      await writeFile(join(makeDir, item.source.replace("0.17.0", "0.16.0")), "stale artifact");
    }
    await writeFile(join(packageResources, "oauth.json"), JSON.stringify({ clientId: CLIENT_ID }));

    const output = await collectReleaseArtifact({
      platform: item.platform,
      arch: item.arch,
      version: "0.17.0",
      outDir: join(root, "out"),
      outputDir
    });

    assert.equal(output.name, item.target);
    assert.equal(await readFile(output.path, "utf8"), "artifact");
    assert.match(await readFile(`${output.path}.sha256`, "utf8"), new RegExp(`^[a-f0-9]{64}  ${item.target}\\n$`));
  }
});

test("release collection rejects packages without OAuth configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-release-"));
  const makeDir = join(root, "out", "make");
  await mkdir(makeDir, { recursive: true });
  await writeFile(join(makeDir, "PolyAsk.zip"), "artifact");

  await assert.rejects(
    collectReleaseArtifact({
      platform: "darwin",
      arch: "x64",
      version: "0.17.0",
      outDir: join(root, "out"),
      outputDir: join(root, "release")
    }),
    /oauth_not_packaged/
  );
});

test("Windows release collection includes installer and portable archives", async () => {
  const collectReleaseArtifacts = releaseArtifacts.collectReleaseArtifacts;
  assert.equal(typeof collectReleaseArtifacts, "function");
  const root = await mkdtemp(join(tmpdir(), "polyask-release-"));
  const makeDir = join(root, "out", "make", "target");
  const packageResources = join(root, "out", "PolyAsk-win32-x64", "resources");
  const outputDir = join(root, "release");
  await mkdir(makeDir, { recursive: true });
  await mkdir(packageResources, { recursive: true });
  await writeFile(join(makeDir, "PolyAsk Setup.exe"), "installer");
  await writeFile(join(makeDir, "PolyAsk-win32-x64-0.17.0.zip"), "portable");
  await writeFile(join(packageResources, "oauth.json"), JSON.stringify({ clientId: CLIENT_ID }));

  const outputs = await collectReleaseArtifacts({
    platform: "win32",
    arch: "x64",
    version: "0.17.0",
    outDir: join(root, "out"),
    outputDir
  });

  assert.deepEqual(outputs.map((output) => output.name), [
    "polyask-desktop-v0.17.0-windows-x64.exe",
    "polyask-desktop-v0.17.0-windows-x64-portable.zip"
  ]);
  assert.equal(await readFile(outputs[0].path, "utf8"), "installer");
  assert.equal(await readFile(outputs[1].path, "utf8"), "portable");
  for (const output of outputs) {
    assert.match(await readFile(`${output.path}.sha256`, "utf8"), new RegExp(`^[a-f0-9]{64}  ${output.name}\\n$`));
  }
});
