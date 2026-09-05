export interface AccessTokenProvider {
  accessToken(forceRefresh: boolean): Promise<string>;
}

export interface DriveFile {
  readonly id: string;
  readonly name?: string;
  readonly appProperties?: Readonly<Record<string, string>>;
}

export interface DriveChange {
  readonly fileId?: string;
  readonly removed?: boolean;
  readonly file?: DriveFile;
}

export interface DriveFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly reason?: string;
  readonly retryAfter?: number;
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

/** A hint of zero (or an already elapsed HTTP-date) is no hint: it would defeat backoff. */
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) > 0 ? Number(value) * 1_000 : undefined;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  const wait = at - Date.now();
  return wait > 0 ? wait : undefined;
}

export class DriveClient {
  constructor(
    private readonly tokens: AccessTokenProvider,
    private readonly fetch: Fetch = globalThis.fetch,
    private readonly requestTimeoutMs = 30_000
  ) {}

  async listFiles(signal?: AbortSignal): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | null = null;
    do {
      const query = new URLSearchParams({ spaces: "appDataFolder", q: "trashed=false", pageSize: "1000", fields: "nextPageToken,files(id,name,mimeType,modifiedTime,appProperties)" });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await this.json<{ files?: DriveFile[]; nextPageToken?: string }>(`${API}/files?${query}`, { signal });
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken ?? null;
    } while (pageToken);
    return files;
  }

  async getStartToken(signal?: AbortSignal): Promise<string> {
    const query = new URLSearchParams({ spaces: "appDataFolder", fields: "startPageToken" });
    const result = await this.json<{ startPageToken?: string }>(`${API}/changes/startPageToken?${query}`, { signal });
    if (!result.startPageToken) throw failure("invalid_response", 200);
    return result.startPageToken;
  }

  async listChanges(pageToken: string, signal?: AbortSignal): Promise<{ changes: DriveChange[]; newStartPageToken: string | null }> {
    const changes: DriveChange[] = [];
    let next: string | null = pageToken;
    let fresh: string | null = null;
    do {
      const query: URLSearchParams = new URLSearchParams({ pageToken: next as string, spaces: "appDataFolder", pageSize: "1000", fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,appProperties))" });
      const page: { changes?: DriveChange[]; nextPageToken?: string; newStartPageToken?: string } = await this.json(`${API}/changes?${query}`, { signal });
      changes.push(...(page.changes ?? []));
      fresh = page.newStartPageToken ?? fresh;
      next = page.nextPageToken ?? null;
    } while (next);
    return { changes, newStartPageToken: fresh };
  }

  download(fileId: string, signal?: AbortSignal): Promise<unknown> {
    return this.json(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, { signal });
  }

  async upsert(fileId: string | null, name: string, appProperties: Readonly<Record<string, string>>, body: unknown, signal?: AbortSignal): Promise<DriveFile> {
    const boundary = `polyask-${crypto.randomUUID()}`;
    const metadata: Record<string, unknown> = { name, mimeType: "application/json", appProperties };
    if (!fileId) metadata.parents = ["appDataFolder"];
    const payload = [`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(metadata), `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(body), `--${boundary}--`, ""].join("\r\n");
    return this.json(fileId ? `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart` : `${UPLOAD}/files?uploadType=multipart`, {
      method: fileId ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: payload,
      signal
    });
  }

  async clearAll(onProgress?: (count: number) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
    let deleted = 0;
    for (const file of await this.listFiles(signal)) {
      if (file.appProperties?.app !== "polyask") continue;
      await this.request(`${API}/files/${encodeURIComponent(file.id)}`, { method: "DELETE", signal });
      await onProgress?.(++deleted);
    }
  }

  private async json<T>(url: string, init: RequestInit): Promise<T> {
    return this.withDeadline(init.signal, async (signal, deadline) => {
      const response = await this.requestWithinDeadline(url, { ...init, signal }, init.signal, deadline);
      try { return JSON.parse(await response.text()) as T; }
      catch (error) {
        throwCallerAbort(init.signal);
        if (deadline.aborted || ["AbortError", "TimeoutError"].includes((error as { name?: string }).name || ""))
          throw failure("network_timeout", response.status);
        throw failure("invalid_response", response.status);
      }
    });
  }

  private request(url: string, init: RequestInit): Promise<Response> {
    return this.withDeadline(init.signal, (signal, deadline) =>
      this.requestWithinDeadline(url, { ...init, signal }, init.signal, deadline));
  }

  private async withDeadline<T>(
    callerSignal: AbortSignal | null | undefined,
    run: (signal: AbortSignal, deadline: AbortSignal) => Promise<T>
  ): Promise<T> {
    throwCallerAbort(callerSignal);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("Timed out", "TimeoutError")), this.requestTimeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal;
    try { return await run(signal, timeout.signal); }
    finally { clearTimeout(timer); }
  }

  private async requestWithinDeadline(
    url: string,
    init: RequestInit,
    callerSignal: AbortSignal | null | undefined,
    deadline: AbortSignal,
    retry401 = true
  ): Promise<Response> {
    if (init.signal?.aborted) {
      throwCallerAbort(callerSignal);
      if (deadline.aborted) throw failure("network_timeout", 0);
      throw new DOMException("Aborted", "AbortError");
    }
    const token = await this.tokens.accessToken(!retry401);
    if (init.signal?.aborted) {
      throwCallerAbort(callerSignal);
      if (deadline.aborted) throw failure("network_timeout", 0);
      throw new DOMException("Aborted", "AbortError");
    }
    let response: Response;
    try {
      response = await this.fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` } });
    } catch (error) {
      throwCallerAbort(callerSignal);
      if (deadline.aborted) throw failure("network_timeout", 0);
      if ((error as { name?: string }).name === "AbortError") throw error;
      throw failure("network_error", 0);
    }
    if (response.status === 401 && retry401)
      return this.requestWithinDeadline(url, init, callerSignal, deadline, false);
    if (!response.ok) throw await responseFailure(response, callerSignal, deadline);
    return response;
  }
}

function failure(code: string, status: number, reason?: string, wait?: number): DriveFailure {
  return Object.assign(new Error(code), { code, status, ...(reason ? { reason } : {}), ...(wait !== undefined ? { retryAfter: wait } : {}) });
}

function throwCallerAbort(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

const RATE_LIMIT_REASONS = new Set(["userratelimitexceeded", "ratelimitexceeded", "quotaexceeded", "dailylimitexceeded"]);

async function responseFailure(
  response: Response,
  callerSignal: AbortSignal | null | undefined,
  deadline: AbortSignal
): Promise<DriveFailure> {
  let reason: string | undefined;
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throwCallerAbort(callerSignal);
    if (deadline.aborted || (error as { name?: string }).name === "TimeoutError") {
      throw failure("network_timeout", response.status);
    }
    throw error;
  }
  try {
    const body = JSON.parse(text) as { error?: { errors?: { reason?: string }[]; message?: string } };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.message;
  } catch { /* Non-JSON error bodies are valid. */ }
  // 403 按 reason 再分流：限流类是可退避重试的 rate_limited；storageQuotaExceeded（存储配额耗尽）不在其列，
  // 继续落 forbidden——否则会对着打不满的配额无限退避空转。清单照抄自扩展时代已真机验证的实现（tag archive/extension-v0.25.1 的 bg/drive.js）。
  // errors[0].reason 是驼峰码（userRateLimitExceeded），error.message 兜底是带空格的句子（"User Rate Limit Exceeded."）：去掉非字母后再查表。
  const rateLimited = response.status === 403 && RATE_LIMIT_REASONS.has(String(reason ?? "").toLowerCase().replace(/[^a-z]/g, ""));
  const code = response.status === 401 ? "unauthorized" : rateLimited ? "rate_limited" : response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : response.status === 410 ? "page_token_expired" : response.status === 429 ? "rate_limited" : response.status >= 500 ? "server_error" : "request_failed";
  return failure(code, response.status, reason, retryAfter(response.headers.get("Retry-After")));
}
