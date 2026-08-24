import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthorizationRequest,
  loadOAuthClientId,
  type RandomBytes
} from "../src/main/oauth-pkce";

const fixedRandom: RandomBytes = (size) => Buffer.alloc(size, 7);

test("desktop OAuth uses S256 PKCE, state and an exact loopback redirect", async () => {
  const request = await buildAuthorizationRequest({
    clientId: "client.apps.googleusercontent.com",
    port: 43_123,
    scope: "https://www.googleapis.com/auth/drive.appdata",
    randomBytes: fixedRandom
  });

  assert.equal(request.url.origin, "https://accounts.google.com");
  assert.equal(request.url.searchParams.get("response_type"), "code");
  assert.equal(request.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(request.url.searchParams.get("redirect_uri"), "http://127.0.0.1:43123");
  assert.equal(request.url.searchParams.get("state"), request.state);
  assert.ok(request.verifier.length >= 43 && request.verifier.length <= 128);
  assert.notEqual(request.url.searchParams.get("code_challenge"), request.verifier);
});

test("desktop OAuth client id never falls back to a Chrome extension client", async () => {
  assert.equal(await loadOAuthClientId({
    environment: { POLYASK_GOOGLE_DESKTOP_CLIENT_ID: "desktop.apps.googleusercontent.com" },
    resourcePath: "/missing/oauth.json",
    readText: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
  }), "desktop.apps.googleusercontent.com");
  assert.equal(await loadOAuthClientId({
    environment: {},
    resourcePath: "/app/oauth.json",
    readText: async () => JSON.stringify({ clientId: "packaged.apps.googleusercontent.com" })
  }), "packaged.apps.googleusercontent.com");
  assert.equal(await loadOAuthClientId({ environment: {}, resourcePath: "/missing/oauth.json", readText: async () => "{}" }), null);
});
