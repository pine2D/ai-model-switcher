import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = `${JSON.stringify({ format: 1, dataDirectory: "PolyAsk Data" }, null, 2)}\n`;
const GUIDE = fileURLToPath(new URL("../resources/portable-readme.txt", import.meta.url));

export async function preparePortableLayout(input) {
  if (input.platform !== "win32" || !/^(x64|arm64)$/.test(input.arch)) {
    throw new Error("invalid_portable_target");
  }
  const packageRoot = join(input.outDir, `PolyAsk-${input.platform}-${input.arch}`);
  const root = join(input.outDir, "portable", "PolyAsk Portable");
  const app = join(root, "App");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await cp(packageRoot, app, { recursive: true, force: true });
  await writeFile(join(root, "portable.json"), MARKER);
  await copyFile(GUIDE, join(root, "README.txt"));
  return { root, app, data: join(root, "PolyAsk Data") };
}

async function main() {
  const [platform, arch] = process.argv.slice(2);
  const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const output = await preparePortableLayout({ outDir: join(desktopRoot, "out"), platform, arch });
  process.stdout.write(`${output.root}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
