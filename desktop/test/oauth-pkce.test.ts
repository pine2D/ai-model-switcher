import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  authorizeWithPkce,
  buildAuthorizationRequest,
  exchangeAuthorizationCode,
  listenLoopback,
  loadOAuthClientCredentials,
  OAUTH_CALLBACK_HTML,
  refreshAccessToken,
  type RandomBytes
} from "../src/main/oauth-pkce";
import { OAuthSession } from "../src/main/oauth-session";
import type { TokenStore } from "../src/main/token-store";

const fixedRandom: RandomBytes = (size) => Buffer.alloc(size, 7);
const execFileAsync = promisify(execFile);
const ENVIRONMENT_CLIENT_SECRET = "test-environment-client-secret";
const PACKAGED_CLIENT_SECRET = "test-packaged-client-secret";
const DESKTOP_CLIENT_SECRET = "test-desktop-client-secret";

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

test("desktop OAuth loads only a complete generated credential pair", async () => {
  assert.deepEqual(await loadOAuthClientCredentials({
    environment: {
      POLYASK_GOOGLE_DESKTOP_CLIENT_ID: "environment.apps.googleusercontent.com",
      POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET: ENVIRONMENT_CLIENT_SECRET
    },
    resourcePath: "/missing/oauth.json",
    readText: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
  }), {
    clientId: "environment.apps.googleusercontent.com",
    clientSecret: ENVIRONMENT_CLIENT_SECRET
  });
  assert.deepEqual(await loadOAuthClientCredentials({
    environment: {},
    resourcePath: "/app/oauth.json",
    readText: async () => JSON.stringify({
      clientId: "packaged.apps.googleusercontent.com",
      clientSecret: PACKAGED_CLIENT_SECRET
    })
  }), {
    clientId: "packaged.apps.googleusercontent.com",
    clientSecret: PACKAGED_CLIENT_SECRET
  });
  assert.equal(await loadOAuthClientCredentials({
    environment: {},
    resourcePath: "/app/oauth.json",
    readText: async () => JSON.stringify({ clientId: "incomplete.apps.googleusercontent.com" })
  }), null);
});

test("packaged desktop builds ignore developer OAuth environment variables", async () => {
  const source = await readFile(resolve(__dirname, "../src/main/sync-runtime.ts"), "utf8");
  assert.match(source, /environment:\s*app\.isPackaged\s*\?\s*undefined\s*:\s*process\.env/);
});

test("the loopback page reports receipt without claiming Drive is connected", () => {
  assert.match(OAUTH_CALLBACK_HTML, /Authorization received/);
  assert.match(OAUTH_CALLBACK_HTML, /已收到授权/);
  assert.match(OAUTH_CALLBACK_HTML, /已收到授權/);
  assert.match(OAUTH_CALLBACK_HTML, /return to PolyAsk to see the result/i);
  assert.doesNotMatch(OAUTH_CALLBACK_HTML, /successfully connected/i);
});

test("the loopback receiver rejects a mismatched state before resolving, so the real callback still wins", async () => {
  const receiver = await listenLoopback();
  try {
    receiver.expect("expected-state");

    const rejected = await fetch(`http://127.0.0.1:${receiver.port}/?code=attacker-code&state=wrong-state`);
    assert.equal(rejected.status, 404);

    const accepted = fetch(`http://127.0.0.1:${receiver.port}/?code=real-code&state=expected-state`);
    const callback = await receiver.receive;
    assert.equal((await accepted).status, 200);

    assert.equal(callback.code, "real-code");
    assert.equal(callback.state, "expected-state");
    assert.equal(callback.error, undefined);
  } finally {
    await receiver.close();
  }
});

test("OAuth token exchange has a bounded network deadline", async () => {
  let receivedSignal = false;
  const fetchWithDeadline: typeof globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    receivedSignal = !!init?.signal;
    const fallback = setTimeout(() => reject(new Error("test_deadline_missing")), 80);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(fallback);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

  await assert.rejects(() => exchangeAuthorizationCode({
    clientId: "client.apps.googleusercontent.com",
    clientSecret: DESKTOP_CLIENT_SECRET,
    code: "code",
    verifier: "verifier",
    redirectUri: "http://127.0.0.1:43123",
    fetch: fetchWithDeadline,
    timeoutMs: 10
  }), (error: unknown) => (error as Error).message === "network_timeout");
  assert.equal(receivedSignal, true);

  const responseWithStalledBody: typeof globalThis.fetch = async (_input, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
    }
  }), { status: 200 });
  await assert.rejects(() => exchangeAuthorizationCode({
    clientId: "client.apps.googleusercontent.com",
    clientSecret: DESKTOP_CLIENT_SECRET,
    code: "code",
    verifier: "verifier",
    redirectUri: "http://127.0.0.1:43123",
    fetch: responseWithStalledBody,
    timeoutMs: 10
  }), (error: unknown) => (error as Error).message === "network_timeout");
});

test("OAuth token exchange identifies the Desktop client with its generated secret", async () => {
  let requestBody = "";
  const token = await exchangeAuthorizationCode({
    clientId: "client.apps.googleusercontent.com",
    clientSecret: DESKTOP_CLIENT_SECRET,
    code: "authorization-code",
    verifier: "verifier",
    redirectUri: "http://127.0.0.1:43123",
    fetch: async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3_600
      }), { status: 200 });
    }
  } as Parameters<typeof exchangeAuthorizationCode>[0] & { readonly clientSecret: string });

  const fields = new URLSearchParams(requestBody);
  assert.equal(fields.get("client_id"), "client.apps.googleusercontent.com");
  assert.equal(fields.get("client_secret"), DESKTOP_CLIENT_SECRET);
  assert.equal(token.accessToken, "access-token");
});

test("OAuth refresh identifies the same Desktop client with its generated secret", async () => {
  let requestBody = "";
  const refresh = refreshAccessToken as unknown as (
    credentials: { readonly clientId: string; readonly clientSecret: string },
    refreshToken: string,
    fetch: typeof globalThis.fetch,
    now: () => number
  ) => ReturnType<typeof refreshAccessToken>;
  const token = await refresh({
    clientId: "client.apps.googleusercontent.com",
    clientSecret: DESKTOP_CLIENT_SECRET
  }, "saved-refresh-token", async (_input, init) => {
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3_600 }), { status: 200 });
  }, () => 1_000);

  const fields = new URLSearchParams(requestBody);
  assert.equal(fields.get("client_id"), "client.apps.googleusercontent.com");
  assert.equal(fields.get("client_secret"), DESKTOP_CLIENT_SECRET);
  assert.equal(fields.get("refresh_token"), "saved-refresh-token");
  assert.equal(token.accessToken, "fresh-access");
});

test("OAuth token exchange preserves safe Google rejection codes", async () => {
  for (const [providerError, expected] of [
    ["invalid_grant", "oauth_invalid_grant"],
    ["invalid_client", "oauth_invalid_client"],
    ["redirect_uri_mismatch", "oauth_redirect_mismatch"]
  ] as const) {
    await assert.rejects(() => exchangeAuthorizationCode({
      clientId: "client.apps.googleusercontent.com",
      clientSecret: DESKTOP_CLIENT_SECRET,
      code: "authorization-code",
      verifier: "verifier",
      redirectUri: "http://127.0.0.1:43123",
      fetch: async () => new Response(JSON.stringify({
        error: providerError,
        error_description: "must not be exposed"
      }), { status: 400 })
    }), (error: unknown) => {
      assert.equal((error as Error).message, expected);
      assert.doesNotMatch((error as Error).message, /must not be exposed/);
      return true;
    });
  }
});

test("OAuth token exchange preserves a bounded diagnostic for an unrecognized Google error", async () => {
  await assert.rejects(() => exchangeAuthorizationCode({
    clientId: "client.apps.googleusercontent.com",
    clientSecret: DESKTOP_CLIENT_SECRET,
    code: "authorization-code",
    verifier: "verifier",
    redirectUri: "http://127.0.0.1:43123",
    fetch: async () => new Response(JSON.stringify({
      error: "invalid_request",
      error_description: "Missing required parameter: client_secret"
    }), { status: 400 })
  }), (error: unknown) => {
    const failure = error as Error & { providerCode?: string; providerDetail?: string };
    assert.equal(failure.message, "oauth_provider_error");
    assert.equal(failure.providerCode, "invalid_request");
    assert.equal(failure.providerDetail, "client_secret");
    return true;
  });
});

test("OAuth token exchange never exposes malformed provider errors", async () => {
  await assert.rejects(() => exchangeAuthorizationCode({
    clientId: "client.apps.googleusercontent.com",
    clientSecret: DESKTOP_CLIENT_SECRET,
    code: "authorization-code",
    verifier: "verifier",
    redirectUri: "http://127.0.0.1:43123",
    fetch: async () => new Response(JSON.stringify({
      error: "invalid request: authorization-code=secret-value",
      error_description: "secret-value"
    }), { status: 400 })
  }), (error: unknown) => {
    assert.equal((error as Error).message, "auth_failed");
    assert.doesNotMatch(String(error), /secret-value/);
    return true;
  });
});

test("OAuth deadlines keep the Node.js event loop alive", async () => {
  const source = await readFile(resolve(__dirname, "../src/main/oauth-pkce.ts"), "utf8");
  assert.doesNotMatch(source, /AbortSignal\.timeout/);
  assert.match(source, /setTimeout/);
});

test("authorization owns token exchange rejection while delayed receiver close runs", async () => {
  const desktopRoot = resolve(__dirname, "..");
  const moduleUrl = pathToFileURL(resolve(desktopRoot, "src/main/oauth-pkce.ts")).href;
  const script = `
    const { authorizeWithPkce } = await import(${JSON.stringify(moduleUrl)});
    const rejectionEvents = [];
    process.on("unhandledRejection", (reason) => {
      rejectionEvents.push(reason instanceof Error ? reason.message : String(reason));
    });
    process.on("rejectionHandled", () => rejectionEvents.push("handled"));

    let resolveReceive;
    let releaseClose;
    let signalCloseStarted;
    let closeFinished = false;
    const receive = new Promise((resolve) => { resolveReceive = resolve; });
    const closeGate = new Promise((resolve) => { releaseClose = resolve; });
    const closeStarted = new Promise((resolve) => { signalCloseStarted = resolve; });

    const authorization = authorizeWithPkce({
      clientId: "client.apps.googleusercontent.com",
      clientSecret: ${JSON.stringify(DESKTOP_CLIENT_SECRET)},
      scope: "https://www.googleapis.com/auth/drive.appdata",
      openExternal: async (url) => {
        resolveReceive({ code: "rejected-code", state: new URL(url).searchParams.get("state") });
      },
      listen: async () => ({
        port: 43_123,
        receive,
        expect: () => {},
        close: async () => {
          signalCloseStarted();
          await closeGate;
          closeFinished = true;
        }
      }),
      fetch: async () => new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    });

    await closeStarted;
    await new Promise((resolve) => setImmediate(resolve));
    releaseClose();
    let outerError = null;
    try { await authorization; }
    catch (error) { outerError = error instanceof Error ? error.message : String(error); }
    await new Promise((resolve) => setImmediate(resolve));
    process.stdout.write(JSON.stringify({ rejectionEvents, outerError, closeFinished }));
  `;

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    { cwd: desktopRoot, encoding: "utf8" }
  );
  const result = JSON.parse(stdout) as {
    readonly rejectionEvents: string[];
    readonly outerError: string | null;
    readonly closeFinished: boolean;
  };

  assert.equal(result.outerError, "oauth_invalid_grant");
  assert.equal(result.closeFinished, true);
  assert.deepEqual(result.rejectionEvents, []);
  assert.equal(stderr, "");
});

test("OAuth session carries the same Desktop credential pair through authorization", async () => {
  let receivedSecret: string | undefined;
  const tokenStore = {
    securePersistence: () => true,
    load: async () => null,
    save: async () => undefined,
    clear: async () => undefined
  } as unknown as TokenStore;
  const session = new OAuthSession({
    credentials: {
      clientId: "client.apps.googleusercontent.com",
      clientSecret: DESKTOP_CLIENT_SECRET
    },
    scope: "https://www.googleapis.com/auth/drive.appdata",
    tokenStore,
    openExternal: async () => undefined,
    authorize: async (input: Parameters<typeof authorizeWithPkce>[0]) => {
      receivedSecret = (input as typeof input & { readonly clientSecret?: string }).clientSecret;
      return {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60_000
      };
    }
  } as unknown as ConstructorParameters<typeof OAuthSession>[0]);

  await session.connect();

  assert.equal(receivedSecret, DESKTOP_CLIENT_SECRET);
});

test("a rotated refresh token that fails to persist is still kept in memory for the next refresh", async () => {
  const savedTokens: string[] = [];
  const refreshCallsSawToken: string[] = [];
  let refreshCount = 0;
  const tokenStore = {
    securePersistence: () => true,
    load: async () => "stored-refresh",
    save: async (value: string) => {
      savedTokens.push(value);
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    },
    clear: async () => undefined
  } as unknown as TokenStore;
  const session = new OAuthSession({
    credentials: {
      clientId: "client.apps.googleusercontent.com",
      clientSecret: DESKTOP_CLIENT_SECRET
    },
    scope: "https://www.googleapis.com/auth/drive.appdata",
    tokenStore,
    openExternal: async () => undefined,
    refresh: async (_credentials, refreshToken) => {
      refreshCount += 1;
      refreshCallsSawToken.push(refreshToken);
      return {
        accessToken: `access-${refreshCount}`,
        refreshToken: refreshCount === 1 ? "rotated-refresh" : null,
        expiresAt: Date.now() + 60_000
      };
    }
  });

  assert.equal(await session.accessToken(true), "access-1");
  assert.equal(await session.accessToken(true), "access-2");

  assert.deepEqual(refreshCallsSawToken, ["stored-refresh", "rotated-refresh"]);
  assert.deepEqual(savedTokens, ["rotated-refresh"]);
});

test("OAuth session distinguishes secure token-storage failures", async () => {
  const tokenStore = {
    securePersistence: () => true,
    load: async () => null,
    save: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); }
  } as unknown as TokenStore;
  const session = new OAuthSession({
    credentials: {
      clientId: "client.apps.googleusercontent.com",
      clientSecret: DESKTOP_CLIENT_SECRET
    },
    scope: "https://www.googleapis.com/auth/drive.appdata",
    tokenStore,
    openExternal: async () => undefined,
    authorize: async () => ({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000
    })
  });

  await assert.rejects(
    () => session.connect(),
    (error: unknown) => (error as Error).message === "token_store_failed"
  );
});
