import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ID = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;

export async function writeOAuthResource(clientId, path) {
  const normalized = clientId?.trim();
  if (!normalized || !CLIENT_ID.test(normalized)) throw new Error("invalid_desktop_oauth_client_id");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ clientId: normalized }, null, 2)}\n`, { mode: 0o644 });
  await chmod(path, 0o644);
}

async function main() {
  const path = fileURLToPath(new URL("../resources/oauth.json", import.meta.url));
  await writeOAuthResource(process.env.POLYASK_GOOGLE_DESKTOP_CLIENT_ID, path);
  process.stdout.write("Desktop OAuth resource configured.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
