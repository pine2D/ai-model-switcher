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

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
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
    const response = await this.request(url, init);
    try { return JSON.parse(await response.text()) as T; }
    catch (error) {
      if (init.signal?.aborted) throw error;
      if ((error as { name?: string }).name === "AbortError") throw failure("network_timeout", response.status);
      throw failure("invalid_response", response.status);
    }
  }

  private async request(url: string, init: RequestInit, retry401 = true): Promise<Response> {
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const token = await this.tokens.accessToken(!retry401);
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const deadline = AbortSignal.timeout(this.requestTimeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    let response: Response;
    try {
      response = await this.fetch(url, { ...init, signal, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` } });
    } catch (error) {
      if (!init.signal?.aborted && deadline.aborted) throw failure("network_timeout", 0);
      if ((error as { name?: string }).name === "AbortError") throw error;
      throw failure("network_error", 0);
    }
    if (response.status === 401 && retry401) return this.request(url, init, false);
    if (!response.ok) throw await responseFailure(response, init.signal, deadline);
    return response;
  }
}

function failure(code: string, status: number, reason?: string, wait?: number): DriveFailure {
  return Object.assign(new Error(code), { code, status, ...(reason ? { reason } : {}), ...(wait !== undefined ? { retryAfter: wait } : {}) });
}

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
    if (callerSignal?.aborted) throw error;
    if (deadline.aborted || (error as { name?: string }).name === "TimeoutError") {
      throw failure("network_timeout", response.status);
    }
    throw error;
  }
  try {
    const body = JSON.parse(text) as { error?: { errors?: { reason?: string }[]; message?: string } };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.message;
  } catch { /* Non-JSON error bodies are valid. */ }
  const code = response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : response.status === 410 ? "page_token_expired" : response.status === 429 ? "rate_limited" : response.status >= 500 ? "server_error" : "request_failed";
  return failure(code, response.status, reason, retryAfter(response.headers.get("Retry-After")));
}
