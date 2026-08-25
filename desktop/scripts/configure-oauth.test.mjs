import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeOAuthResource } from "./configure-oauth.mjs";

test("OAuth build resource accepts only a Google Desktop client id", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-oauth-"));
  const path = join(root, "resources", "oauth.json");
  const clientId = "test-client.apps.googleusercontent.com";

  await writeOAuthResource(clientId, path);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { clientId });
  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o644);
  }
  await assert.rejects(writeOAuthResource("not-a-client", path), /invalid_desktop_oauth_client_id/);
});
