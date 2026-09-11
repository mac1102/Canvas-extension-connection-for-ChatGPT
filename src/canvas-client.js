const BASE = "https://canvas.uva.nl";
export class CanvasApiError extends Error {
  constructor(message, { status = null } = {}) { super(message); this.name = "CanvasApiError"; this.status = status; }
}
export async function readBounded(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new CanvasApiError("Resource exceeds byte limit."); }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new CanvasApiError("Resource exceeds byte limit.");
    return bytes;
  }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new CanvasApiError("Resource exceeds byte limit."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export function parseNextLink(header, base = BASE) {
  for (const part of String(header || "").split(/,(?=\s*<)/)) {
    const target = part.match(/<([^>]+)>/), rel = part.match(/;\s*rel\s*=\s*"?([^";,]+)"?/i);
    if (target && rel?.[1].split(/\s+/).includes("next")) return new URL(target[1], base);
  }
  return null;
}
const id = (value) => { const str = String(value); if (!/^\d+$/.test(str)) throw new CanvasApiError("Invalid resource ID."); return str; };
const slug = (value) => { if (!value || String(value).length > 200 || /[/\\?#]/.test(value)) throw new CanvasApiError("Invalid page ID."); return encodeURIComponent(value); };
export class CanvasClient {
  constructor({ token, baseUrl = BASE, timeoutMs = 15000, fetchImpl = fetch, maxRequests = 180, maxBytes = 32 * 1024 * 1024 } = {}) {
    if (baseUrl !== BASE) throw new CanvasApiError("This build supports only https://canvas.uva.nl.");
    if (!token) throw new CanvasApiError("Canvas access token is not configured. Open Settings.");
    this.token = token; this.baseUrl = BASE; this.timeoutMs = timeoutMs; this.fetchImpl = fetchImpl;
    this.cache = new Map(); this.warnings = []; this.requestCount = 0; this.maxRequests = maxRequests;
    this.bytesRead = 0; this.bytesReserved = 0; this.maxBytes = maxBytes; this.rateLimited = false;
  }
  url(path, params = {}, api = true) {
    const url = new URL(path, BASE);
    if (url.origin !== BASE || url.username || url.password || (api && !url.pathname.startsWith("/api/v1/"))) throw new CanvasApiError("Untrusted Canvas destination.");
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") {
      for (const item of [].concat(value)) url.searchParams.append(key, String(item));
    }
    return url;
  }
  async read(url, { api = true, maxBytes = 4 * 1024 * 1024 } = {}) {
    this.url(url, {}, api);
    if (this.rateLimited) throw new CanvasApiError("Canvas rate limit reached. Retry later.", { status: 429 });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (++this.requestCount > this.maxRequests) throw new CanvasApiError("Request budget reached.");
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: "GET", headers: { Authorization: `Bearer ${this.token}`, Accept: api ? "application/json" : "*/*" },
          credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal
        });
        if (!response.ok) {
          if (response.status === 429) this.rateLimited = true;
          if (response.status >= 500 && attempt === 0) { await response.body?.cancel(); continue; }
          throw new CanvasApiError(response.status === 401 ? "Canvas rejected the token. Replace it in Settings."
            : response.status === 429 ? "Canvas rate limit reached. Retry later."
            : `Canvas resource unavailable (HTTP ${response.status}).`, { status: response.status });
        }
        const allowance = Math.max(0, Math.min(maxBytes, this.maxBytes - this.bytesRead - this.bytesReserved));
        this.bytesReserved += allowance;
        try {
          const bytes = await readBounded(response, allowance);
          this.bytesRead += bytes.byteLength;
          return { bytes, link: response.headers.get("link"), contentType: response.headers.get("content-type") };
        } finally { this.bytesReserved -= allowance; }
      } catch (error) {
        if (!(error instanceof CanvasApiError) && error.name !== "AbortError" && attempt === 0) continue;
        if (error instanceof CanvasApiError) throw error;
        throw new CanvasApiError(error.name === "AbortError" ? "Canvas request timed out." : "Canvas network request or untrusted redirect failed.");
      } finally { clearTimeout(timer); }
    }
  }
  cached(key, work) { if (!this.cache.has(key)) this.cache.set(key, work()); return this.cache.get(key); }
  async request(path, params = {}) {
    const url = this.url(path, params);
    return this.cached(url.href, async () => {
      const result = await this.read(url);
      try { return { data: JSON.parse(new TextDecoder().decode(result.bytes)), link: result.link }; }
      catch { throw new CanvasApiError("Invalid Canvas JSON response."); }
    });
  }
  async get(path, params = {}) { return (await this.request(path, params)).data; }
  async getAll(path, params = {}, maxPages = 30) {
    let url = this.url(path, { per_page: 100, ...params }); const output = [], seen = new Set(); output.complete = true;
    for (let page = 0; url; page++) {
      try {
        if (page >= maxPages || seen.has(url.href)) throw new CanvasApiError("Pagination limit or cycle.");
        seen.add(url.href); const result = await this.request(url);
        if (!Array.isArray(result.data)) throw new CanvasApiError("Expected Canvas list.");
        output.push(...result.data); url = parseNextLink(result.link, url);
      } catch (error) {
        if (!output.length || error.status === 401) throw error;
        output.complete = false; this.warnings.push("Partial list: pagination failed or reached its limit."); break;
      }
    }
    return output;
  }
  getCurrentUser() { return this.get("/api/v1/users/self"); }
  getActiveCourses() { return this.getAll("/api/v1/courses", { "state[]": ["available", "completed"], "include[]": ["term"] }); }
  getCourseDetails(c) { return this.get('/api/v1/courses/' + id(c), { "include[]": ["syllabus_body", "term"] }); }
  getAssignments(c) { return this.getAll('/api/v1/courses/' + id(c) + '/assignments', { order_by: "due_at", "include[]": ["submission"] }); }
  getAssignment(c, a) { return this.get('/api/v1/courses/' + id(c) + '/assignments/' + id(a), { "include[]": ["submission"] }); }
  getAssignmentGroups(c) { return this.getAll('/api/v1/courses/' + id(c) + '/assignment_groups'); }
  getRubric(c, r) { return this.get('/api/v1/courses/' + id(c) + '/rubrics/' + id(r)); }
  getSubmission(c, a) { return this.get('/api/v1/courses/' + id(c) + '/assignments/' + id(a) + '/submissions/self'); }
  getModules(c) { return this.getAll('/api/v1/courses/' + id(c) + '/modules', { "include[]": ["items"] }); }
  getModuleItems(c, m) { return this.getAll('/api/v1/courses/' + id(c) + '/modules/' + id(m) + '/items'); }
  getPages(c) { return this.getAll('/api/v1/courses/' + id(c) + '/pages', { sort: "updated_at", order: "desc" }); }
  getPage(c, p) { return this.get('/api/v1/courses/' + id(c) + '/pages/' + slug(p)); }
  getFiles(c) { return this.getAll('/api/v1/courses/' + id(c) + '/files', { sort: "updated_at", order: "desc" }); }
  getFile(c, f) { return this.get('/api/v1/courses/' + id(c) + '/files/' + id(f)); }
  getFolders(c) { return this.getAll('/api/v1/courses/' + id(c) + '/folders'); }
  getFolderFiles(f) { return this.getAll('/api/v1/folders/' + id(f) + '/files'); }
  getFolderFolders(f) { return this.getAll('/api/v1/folders/' + id(f) + '/folders'); }
  getEnrollments() { return this.getAll("/api/v1/users/self/enrollments", { "type[]": ["StudentEnrollment"], "state[]": ["active", "completed"] }); }
  getTodo() { return this.getAll("/api/v1/users/self/todo"); }
  getAnnouncements(ids, { startDate = new Date(Date.now() - 30 * 86400000), endDate = new Date() } = {}) {
    return ids.length ? this.getAll("/api/v1/announcements", { "context_codes[]": ids.map((c) => 'course_' + id(c)), start_date: startDate.toISOString(), end_date: endDate.toISOString(), active_only: true }) : Promise.resolve([]);
  }
  async downloadFile(file, maxBytes = 8 * 1024 * 1024) {
    if (file.locked_for_user || file.hidden_for_user) throw new CanvasApiError("File is locked or hidden.");
    if (file.size > maxBytes) throw new CanvasApiError("File exceeds document size limit.");
    if (!file.url) throw new CanvasApiError("File has no download URL.");
    const url = this.url(file.url, {}, false);
    if (!/^\/(?:courses\/\d+\/)?files\/\d+(?:\/download)?\/?$/.test(url.pathname)) throw new CanvasApiError("Unsupported file download path.");
    return this.cached("file:" + url.href, async () => (await this.read(url, { api: false, maxBytes })).bytes);
  }
}
