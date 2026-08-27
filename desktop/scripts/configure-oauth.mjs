import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ID = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET = /^[A-Za-z0-9._~-]{8,256}$/;

export async function writeOAuthResource(credentials, path) {
  const clientId = credentials?.clientId?.trim();
  const clientSecret = credentials?.clientSecret?.trim();
  if (!clientId || !CLIENT_ID.test(clientId) || !clientSecret || !CLIENT_SECRET.test(clientSecret)) {
    throw new Error("invalid_desktop_oauth_credentials");
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ clientId, clientSecret }, null, 2)}\n`, { mode: 0o644 });
  await chmod(path, 0o644);
}

async function main() {
  const path = fileURLToPath(new URL("../resources/oauth.json", import.meta.url));
  await writeOAuthResource({
    clientId: process.env.POLYASK_GOOGLE_DESKTOP_CLIENT_ID,
    clientSecret: process.env.POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET
  }, path);
  process.stdout.write("Desktop OAuth resource configured.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
