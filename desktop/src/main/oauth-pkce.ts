import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";

export type RandomBytes = (size: number) => Buffer;

export interface AuthorizationRequest {
  readonly url: URL;
  readonly state: string;
  readonly verifier: string;
  readonly redirectUri: string;
}

interface BuildAuthorizationInput {
  readonly clientId: string;
  readonly port: number;
  readonly scope: string;
  readonly randomBytes?: RandomBytes;
}

interface LoadClientInput {
  readonly environment?: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;
  readonly resourcePath: string;
  readonly readText?: (path: string) => Promise<string>;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number;
}

const CLIENT_ID = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;
const encode = (value: Buffer) => value.toString("base64url");
const NETWORK_TIMEOUT_MS = 30_000;

export const OAUTH_CALLBACK_HTML = `<!doctype html><meta charset="utf-8"><title>PolyAsk</title>
<p>Authorization received. PolyAsk is verifying the connection; return to PolyAsk to see the result.</p>
<p lang="zh-CN">已收到授权。PolyAsk 正在验证连接，请返回应用查看结果。</p>
<p lang="zh-TW">已收到授權。PolyAsk 正在驗證連線，請返回應用程式查看結果。</p>`;

export async function buildAuthorizationRequest(input: BuildAuthorizationInput): Promise<AuthorizationRequest> {
  if (!CLIENT_ID.test(input.clientId) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new Error("invalid_oauth_configuration");
  }
  const random = input.randomBytes ?? nodeRandomBytes;
  const verifier = encode(random(64));
  const state = encode(random(32));
  const challenge = encode(createHash("sha256").update(verifier).digest());
  const redirectUri = `http://127.0.0.1:${input.port}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({
    client_id: input.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: input.scope,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent"
  })) url.searchParams.set(key, value);
  return { url, state, verifier, redirectUri };
}

export async function loadOAuthClientId(input: LoadClientInput): Promise<string | null> {
  const fromEnvironment = input.environment?.POLYASK_GOOGLE_DESKTOP_CLIENT_ID?.trim();
  if (fromEnvironment && CLIENT_ID.test(fromEnvironment)) return fromEnvironment;
  try {
    const parsed = JSON.parse(await (input.readText ?? ((path) => readFile(path, "utf8")))(input.resourcePath)) as { clientId?: unknown };
    return typeof parsed.clientId === "string" && CLIENT_ID.test(parsed.clientId.trim()) ? parsed.clientId.trim() : null;
  } catch { return null; }
}

interface LoopbackReceiver {
  readonly port: number;
  readonly receive: Promise<{ readonly code?: string; readonly state?: string; readonly error?: string }>;
  close(): Promise<void>;
}

export async function listenLoopback(): Promise<LoopbackReceiver> {
  let resolve!: (value: { code?: string; state?: string; error?: string }) => void;
  const receive = new Promise<{ code?: string; state?: string; error?: string }>((done) => { resolve = done; });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const code = url.searchParams.get("code") ?? undefined;
    const state = url.searchParams.get("state") ?? undefined;
    const error = url.searchParams.get("error") ?? undefined;
    if (!code && !error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", Connection: "close" });
    response.end(OAUTH_CALLBACK_HTML);
    resolve({ code, state, error });
  });
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveReady());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("oauth_listener_failed");
  return { port: address.port, receive, close: () => closeServer(server) };
}

interface AuthorizeInput {
  readonly clientId: string;
  readonly scope: string;
  readonly openExternal: (url: string) => Promise<void>;
  readonly listen?: () => Promise<LoopbackReceiver>;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export async function authorizeWithPkce(input: AuthorizeInput): Promise<TokenSet> {
  const receiver = await (input.listen ?? listenLoopback)();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = await buildAuthorizationRequest({ clientId: input.clientId, port: receiver.port, scope: input.scope });
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("oauth_timeout")), input.timeoutMs ?? 300_000);
    });
    await input.openExternal(request.url.href);
    const callback = await Promise.race([receiver.receive, timedOut]);
    if (callback.error) throw new Error("oauth_denied");
    if (!callback.state || callback.state !== request.state) throw new Error("oauth_state_mismatch");
    if (!callback.code) throw new Error("oauth_code_missing");
    return await exchangeAuthorizationCode({
      clientId: input.clientId,
      code: callback.code,
      verifier: request.verifier,
      redirectUri: request.redirectUri,
      fetch: input.fetch,
      now: input.now
    });
  } finally {
    if (timer) clearTimeout(timer);
    await receiver.close();
  }
}

interface ExchangeInput {
  readonly clientId: string;
  readonly code: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export async function exchangeAuthorizationCode(input: ExchangeInput): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code"
  });
  return tokenRequest(body, input.fetch ?? globalThis.fetch, input.now ?? Date.now, input.timeoutMs);
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  now: () => number = Date.now,
  timeoutMs?: number
): Promise<TokenSet> {
  return tokenRequest(new URLSearchParams({ client_id: clientId, refresh_token: refreshToken, grant_type: "refresh_token" }), fetch, now, timeoutMs);
}

export async function revokeGoogleToken(token: string, fetch: typeof globalThis.fetch = globalThis.fetch, timeoutMs?: number): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs ?? NETWORK_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal
    });
  } catch { throw new Error(signal.aborted ? "network_timeout" : "network_error"); }
  if (!response.ok && response.status !== 400) throw new Error("oauth_revoke_failed");
}

async function tokenRequest(body: URLSearchParams, fetch: typeof globalThis.fetch, now: () => number, timeoutMs = NETWORK_TIMEOUT_MS): Promise<TokenSet> {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal
    });
  } catch { throw new Error(signal.aborted ? "network_timeout" : "network_error"); }
  let value: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  try { value = JSON.parse(await response.text()); }
  catch { throw new Error(signal.aborted ? "network_timeout" : "oauth_invalid_response"); }
  if (!response.ok) throw new Error(response.status === 400 ? "auth_failed" : "oauth_token_failed");
  if (typeof value.access_token !== "string" || !value.access_token || !Number.isFinite(Number(value.expires_in))) {
    throw new Error("oauth_invalid_response");
  }
  return {
    accessToken: value.access_token,
    refreshToken: typeof value.refresh_token === "string" && value.refresh_token ? value.refresh_token : null,
    expiresAt: now() + Math.max(1, Number(value.expires_in)) * 1_000
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
