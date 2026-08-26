import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { preparePortableLayout } from "./prepare-portable.mjs";

test("Windows portable staging separates replaceable app files from persistent data", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-release-"));
  const packageRoot = join(root, "out", "PolyAsk-win32-x64");
  await mkdir(join(packageRoot, "resources"), { recursive: true });
  await writeFile(join(packageRoot, "polyask-desktop.exe"), "executable");
  await writeFile(join(packageRoot, "resources", "app.asar"), "application");

  const output = await preparePortableLayout({ outDir: join(root, "out"), platform: "win32", arch: "x64" });

  assert.equal(await readFile(join(output.root, "portable.json"), "utf8"), "{\n  \"format\": 1,\n  \"dataDirectory\": \"PolyAsk Data\"\n}\n");
  assert.equal(await readFile(join(output.app, "polyask-desktop.exe"), "utf8"), "executable");
  assert.equal(await readFile(join(output.app, "resources", "app.asar"), "utf8"), "application");
  assert.equal(output.data, join(output.root, "PolyAsk Data"));
  await assert.rejects(stat(output.data), /ENOENT/);
  const guide = await readFile(join(output.root, "README.txt"), "utf8");
  assert.match(guide, /App\\polyask-desktop\.exe/);
  assert.match(guide, /保留 PolyAsk Data/);
  assert.match(guide, /保留 PolyAsk Data 資料夾/);
});
