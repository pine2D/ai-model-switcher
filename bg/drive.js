const Drive = (() => {
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  let cachedToken = null;

  function params(values) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value != null) query.set(key, value);
    return query;
  }

  function retryAfter(value) {
    if (!value) return undefined;
    if (/^\d+$/.test(value)) return Number(value) * 1000;
    const at = Date.parse(value);
    return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
  }

  async function driveError(response) {
    let details = null;
    try { details = JSON.parse(await response.text()); } catch (e) { /* non-JSON Drive errors are valid */ }
    const status = response.status;
    const code = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "not_found" :
      status === 429 ? "rate_limited" : status >= 500 ? "server_error" : "request_failed";
    const error = { code, status };
    const wait = retryAfter(response.headers.get("Retry-After"));
    if (wait !== undefined) error.retryAfter = wait;
    const reason = details?.error?.errors?.[0]?.reason || details?.error?.message;
    if (reason) error.reason = reason;
    return error;
  }

  async function connect(interactive = false) {
    if (cachedToken && !interactive) return cachedToken;
    try {
      const result = await chrome.identity.getAuthToken({ interactive });
      const token = typeof result === "string" ? result : result?.token;
      if (!token) throw new Error("token missing");
      cachedToken = token;
      return token;
    } catch (error) {
      throw { code: "auth_failed", status: 0, reason: error?.message };
    }
  }

  async function request(url, init = {}, retry401 = true) {
    const token = await connect(false);
    let response;
    try {
      response = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch (error) {
      throw { code: "network_error", status: 0, reason: error?.message };
    }
    if (response.status === 401 && retry401) {
      cachedToken = null;
      try { await chrome.identity.removeCachedAuthToken({ token }); } catch (e) { /* retry still obtains a fresh token */ }
      return request(url, init, false);
    }
    if (!response.ok) throw await driveError(response);
    return response;
  }

  async function json(response) {
    try { return await response.json(); } catch (e) { throw { code: "invalid_response", status: response.status }; }
  }

  async function listPage(pageToken = null, pageSize = 1000) {
    const query = params({
      spaces: "appDataFolder", q: "trashed=false", pageSize, pageToken,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,appProperties)",
    });
    return json(await request(`${API}/files?${query}`));
  }

  async function listFiles() {
    const files = [];
    let pageToken = null;
    do {
      const page = await listPage(pageToken);
      files.push(...(page.files || []));
      pageToken = page.nextPageToken || null;
    } while (pageToken);
    return files;
  }

  async function getStartToken() {
    const page = await json(await request(`${API}/changes/startPageToken?${params({ spaces: "appDataFolder", fields: "startPageToken" })}`));
    return page.startPageToken;
  }

  async function listChanges(pageToken) {
    const changes = [];
    let next = pageToken, newStartPageToken = null;
    do {
      const page = await json(await request(`${API}/changes?${params({
        pageToken: next, spaces: "appDataFolder", pageSize: 1000,
        fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,appProperties))",
      })}`));
      changes.push(...(page.changes || []));
      newStartPageToken = page.newStartPageToken || newStartPageToken;
      next = page.nextPageToken || null;
    } while (next);
    return { changes, newStartPageToken };
  }

  async function download(fileId) {
    return json(await request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`));
  }

  async function upsert(fileId, name, appProperties, body) {
    const boundary = crypto.randomUUID();
    const metadata = { name, mimeType: "application/json", appProperties: appProperties || {} };
    if (!fileId) metadata.parents = ["appDataFolder"];
    const payload = [
      `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(metadata),
      `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", typeof body === "string" ? body : JSON.stringify(body),
      `--${boundary}--`, "",
    ].join("\r\n");
    const url = fileId ? `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart` : `${UPLOAD}/files?uploadType=multipart`;
    const response = await request(url, {
      method: fileId ? "PATCH" : "POST", body: payload,
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    });
    return json(response);
  }

  async function remove(fileId) {
    await request(`${API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  }

  async function clearAll(onProgress) {
    let deleted = 0;
    while (true) {
      const page = await listPage(null, 100);
      const files = (page.files || []).filter((file) => file.appProperties?.app === "polyask");
      if (!files.length) return;
      for (const file of files) {
        await remove(file.id);
        deleted++;
        if (onProgress) onProgress(deleted);
      }
    }
  }

  async function disconnect() {
    cachedToken = null;
    try {
      await chrome.identity.clearAllCachedAuthTokens();
    } catch (error) {
      throw { code: "auth_failed", status: 0, reason: error?.message };
    }
  }

  return { connect, disconnect, listFiles, getStartToken, listChanges, download, upsert, remove, clearAll };
})();
