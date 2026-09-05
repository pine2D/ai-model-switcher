import assert from "node:assert/strict";
import test from "node:test";

import { DriveClient, type AccessTokenProvider } from "../src/main/drive-client";
import { readSource } from "./fixtures";

test("Drive deadline uses a referenced timer so an isolated request cannot outlive the event loop", () => {
  const source = readSource("src/main/drive-client.ts");
  assert.doesNotMatch(source, /AbortSignal\.timeout/, "AbortSignal.timeout uses an unrefed Node timer");
  assert.match(source, /setTimeout\(/);
});

test("Drive retries one 401 with a refreshed token and stays inside appDataFolder", async () => {
  const force: boolean[] = [];
  const provider: AccessTokenProvider = { accessToken: async (refresh) => { force.push(refresh); return refresh ? "fresh" : "stale"; } };
  const urls: URL[] = [];
  let calls = 0;
  const client = new DriveClient(provider, async (input, init) => {
    calls += 1;
    urls.push(new URL(String(input)));
    if (calls === 1) return new Response("", { status: 401 });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fresh");
    return Response.json({ files: [{ id: "file-a", appProperties: { app: "polyask" } }] });
  });

  const files = await client.listFiles();

  assert.deepEqual(force, [false, true]);
  assert.equal(urls[0].searchParams.get("spaces"), "appDataFolder");
  assert.equal(urls[0].searchParams.get("q"), "trashed=false");
  assert.equal(files[0].id, "file-a");
});

test("Drive paginates files and changes and exposes stable transport failures", async () => {
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  const client = new DriveClient(provider, async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/files")) {
      return url.searchParams.get("pageToken")
        ? Response.json({ files: [{ id: "b" }] })
        : Response.json({ files: [{ id: "a" }], nextPageToken: "next" });
    }
    return url.searchParams.get("pageToken") === "next"
      ? Response.json({ changes: [{ fileId: "b", removed: true }], newStartPageToken: "fresh" })
      : Response.json({ changes: [{ file: { id: "a" } }], nextPageToken: "next" });
  });
  assert.deepEqual((await client.listFiles()).map((file) => file.id), ["a", "b"]);
  const changes = await client.listChanges("start");
  assert.equal(changes.changes.length, 2);
  assert.equal(changes.newStartPageToken, "fresh");

  const expired = new DriveClient(provider, async () => new Response("gone", { status: 410 }));
  await assert.rejects(() => expired.listChanges("old"), (error: unknown) => (error as { code?: string }).code === "page_token_expired");
  const limited = new DriveClient(provider, async () => new Response(JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } }), { status: 429, headers: { "Retry-After": "3" } }));
  await assert.rejects(() => limited.listFiles(), (error: unknown) => (error as { retryAfter?: number }).retryAfter === 3_000);
  const malformed = new DriveClient(provider, async () => new Response("not-json"));
  await assert.rejects(() => malformed.listFiles(), (error: unknown) => (error as { code?: string }).code === "invalid_response");
});

test("Drive clear removes only PolyAsk files and honors cancellation", async () => {
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  const deleted: string[] = [];
  const controller = new AbortController();
  const client = new DriveClient(provider, async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "DELETE") { deleted.push(url.pathname.split("/").at(-1)!); return new Response(null, { status: 204 }); }
    return Response.json({ files: [
      { id: "ours", appProperties: { app: "polyask" } },
      { id: "other", appProperties: { app: "another-app" } }
    ] });
  });
  await client.clearAll(undefined, controller.signal);
  assert.deepEqual(deleted, ["ours"]);
  controller.abort();
  await assert.rejects(() => client.listFiles(controller.signal), (error: unknown) => (error as { name?: string }).name === "AbortError");
});

test("Drive requests time out without masking caller cancellation", async () => {
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  let receivedSignal = false;
  const fetchWithDeadline: typeof globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    receivedSignal = !!init?.signal;
    const fallback = setTimeout(() => reject(new Error("test_deadline_missing")), 80);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(fallback);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
  const timed = new DriveClient(provider, fetchWithDeadline, 10);
  await assert.rejects(() => timed.listFiles(), (error: unknown) => (error as { code?: string }).code === "network_timeout");
  assert.equal(receivedSignal, true);

  const stalledBody: typeof globalThis.fetch = async (_input, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
    }
  }), { status: 200 });
  await assert.rejects(
    () => new DriveClient(provider, stalledBody, 10).listFiles(),
    (error: unknown) => (error as { code?: string }).code === "network_timeout"
  );

  const controller = new AbortController();
  const cancelled = new DriveClient(provider, fetchWithDeadline, 1_000);
  const request = cancelled.listFiles(controller.signal);
  controller.abort();
  await assert.rejects(() => request, (error: unknown) => (error as { name?: string }).name === "AbortError");
});

test("Drive preserves timeout and caller cancellation while reading an error body", async () => {
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  const stalledError = (started?: () => void): typeof globalThis.fetch => async (_input, init) =>
    new Response(new ReadableStream({
      start(controller) {
        started?.();
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }
    }), { status: 500 });

  await assert.rejects(
    () => new DriveClient(provider, stalledError(), 10).listFiles(),
    (error: unknown) => (error as { code?: string }).code === "network_timeout"
  );

  let bodyStarted!: () => void;
  const started = new Promise<void>((resolve) => { bodyStarted = resolve; });
  const controller = new AbortController();
  const request = new DriveClient(provider, stalledError(bodyStarted), 1_000)
    .listFiles(controller.signal);
  await started;
  controller.abort();
  await assert.rejects(
    () => request,
    (error: unknown) => (error as { name?: string }).name === "AbortError"
  );
});

test("Drive ignores a Retry-After hint that would schedule an immediate retry", async () => {
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  const hinted = (status: number, value: string) =>
    new DriveClient(provider, async () => new Response("{}", { status, headers: { "Retry-After": value } }));

  await assert.rejects(
    () => hinted(429, "0").listFiles(),
    (error: unknown) => (error as { code?: string }).code === "rate_limited"
      && (error as { retryAfter?: number }).retryAfter === undefined
  );
  await assert.rejects(
    () => hinted(503, new Date(Date.now() - 60_000).toUTCString()).listFiles(),
    (error: unknown) => (error as { code?: string }).code === "server_error"
      && (error as { retryAfter?: number }).retryAfter === undefined
  );
  await assert.rejects(
    () => hinted(429, new Date(Date.now() + 120_000).toUTCString()).listFiles(),
    (error: unknown) => ((error as { retryAfter?: number }).retryAfter ?? 0) > 60_000
  );
});
