const DEFAULT_BASE_URL = "https://canvas.uva.nl";
const DEFAULT_TIMEOUT_MS = 15000;

export class CanvasApiError extends Error {
  constructor(message, { status = null, endpoint = null, cause = null } = {}) {
    super(message, { cause });
    this.name = "CanvasApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class CanvasClient {
  constructor({ token, baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.token = String(token || "").trim();
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.timeoutMs = Math.max(3000, Math.min(30000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    if (!this.token) throw new CanvasApiError("Canvas access token is not configured.");
  }

  async request(path, params = {}) {
    const url = new URL(path, `${this.baseUrl}/`);
    appendParams(url, params);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json"
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal
      });

      if (!response.ok) {
        throw await toCanvasError(response, url.pathname);
      }

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      return { data, link: response.headers.get("Link") || "" };
    } catch (error) {
      if (error instanceof CanvasApiError) throw error;
      if (error?.name === "AbortError") {
        throw new CanvasApiError(`Canvas request timed out after ${this.timeoutMs / 1000}s.`, {
          endpoint: url.pathname,
          cause: error
        });
      }
      throw new CanvasApiError(`Could not reach Canvas: ${error?.message || String(error)}`, {
        endpoint: url.pathname,
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async get(path, params = {}) {
    return (await this.request(path, params)).data;
  }

  async getAll(path, params = {}, maxPages = 10) {
    const firstUrl = new URL(path, `${this.baseUrl}/`);
    appendParams(firstUrl, { ...params, per_page: params.per_page || 100 });

    let url = firstUrl;
    const output = [];

    for (let page = 0; page < maxPages && url; page += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json"
          },
          cache: "no-store",
          credentials: "omit",
          redirect: "follow",
          signal: controller.signal
        });

        if (!response.ok) throw await toCanvasError(response, url.pathname);
        const data = await response.json();
        if (!Array.isArray(data)) return data;
        output.push(...data);
        url = parseNextLink(response.headers.get("Link"));
      } catch (error) {
        if (error instanceof CanvasApiError) throw error;
        if (error?.name === "AbortError") {
          throw new CanvasApiError(`Canvas request timed out after ${this.timeoutMs / 1000}s.`, {
            endpoint: url.pathname,
            cause: error
          });
        }
        throw new CanvasApiError(`Could not reach Canvas: ${error?.message || String(error)}`, {
          endpoint: url.pathname,
          cause: error
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    return output;
  }

  getCurrentUser() {
    return this.get("/api/v1/users/self");
  }

  getActiveCourses() {
    return this.getAll("/api/v1/courses", {
      enrollment_state: "active",
      "state[]": ["available", "completed"],
      "include[]": ["term", "total_scores", "favorites"]
    });
  }

  getTodo() {
    return this.getAll("/api/v1/users/self/todo", { per_page: 100 }, 4);
  }

  getAssignments(courseId) {
    return this.getAll(`/api/v1/courses/${courseId}/assignments`, {
      order_by: "due_at",
      "include[]": ["submission"]
    });
  }

  getAssignment(courseId, assignmentId) {
    return this.get(`/api/v1/courses/${courseId}/assignments/${assignmentId}`);
  }

  getAnnouncements(courseIds, { startDate, endDate } = {}) {
    if (!courseIds?.length) return Promise.resolve([]);
    return this.getAll("/api/v1/announcements", {
      "context_codes[]": courseIds.map((id) => `course_${id}`),
      start_date: startDate?.toISOString(),
      end_date: endDate?.toISOString(),
      active_only: true,
      latest_only: false
    });
  }

  getCourseDetails(courseId) {
    return this.get(`/api/v1/courses/${courseId}`, {
      "include[]": ["syllabus_body", "term"]
    });
  }

  getPages(courseId) {
    return this.getAll(`/api/v1/courses/${courseId}/pages`, {
      sort: "updated_at",
      order: "desc"
    }, 4);
  }

  getPage(courseId, pageUrl) {
    return this.get(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`);
  }

  getFiles(courseId, searchTerm = "") {
    return this.getAll(`/api/v1/courses/${courseId}/files`, {
      search_term: searchTerm || undefined,
      sort: "updated_at",
      order: "desc"
    }, 4);
  }

  async getReadableFileText(file, maxChars = 12000) {
    const rawUrl = file?.url;
    if (!rawUrl) return { readable: false, reason: "No download URL" };

    const url = new URL(rawUrl, `${this.baseUrl}/`);
    if (url.protocol !== "https:" || url.hostname !== "canvas.uva.nl") {
      return { readable: false, reason: "File URL is outside the allowed Canvas UvA host" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}` },
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal
      });

      if (!response.ok) throw await toCanvasError(response, url.pathname);

      const contentType = String(response.headers.get("content-type") || file?.["content-type"] || "")
        .split(";", 1)[0]
        .toLowerCase();

      const readable =
        contentType.startsWith("text/") ||
        ["application/json", "application/xml", "application/xhtml+xml"].includes(contentType);

      if (!readable) {
        return {
          readable: false,
          content_type: contentType || null,
          reason: "Binary document parsing is not bundled in this extension"
        };
      }

      const text = await response.text();
      return {
        readable: true,
        content_type: contentType || null,
        text: text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`,
        truncated: text.length > maxChars
      };
    } catch (error) {
      if (error instanceof CanvasApiError) throw error;
      if (error?.name === "AbortError") {
        throw new CanvasApiError(`Canvas file request timed out after ${this.timeoutMs / 1000}s.`, {
          endpoint: url.pathname,
          cause: error
        });
      }
      throw new CanvasApiError(`Could not fetch Canvas file: ${error?.message || String(error)}`, {
        endpoint: url.pathname,
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  getModules(courseId) {
    return this.getAll(`/api/v1/courses/${courseId}/modules`, {
      "include[]": ["items", "content_details"]
    }, 4);
  }

  getEnrollments() {
    return this.getAll("/api/v1/users/self/enrollments", {
      "type[]": ["StudentEnrollment"],
      "state[]": ["active", "completed"],
      "include[]": ["current_points", "current_grading_period_scores"]
    });
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL).trim());
  if (url.protocol !== "https:") throw new CanvasApiError("Canvas URL must use HTTPS.");
  if (url.hostname !== "canvas.uva.nl") {
    throw new CanvasApiError("This build only allows https://canvas.uva.nl for least-privilege host access.");
  }
  return url.origin;
}

function appendParams(url, params) {
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") return new URL(match[1]);
  }
  return null;
}

async function toCanvasError(response, endpoint) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload?.errors?.[0]?.message || payload?.message || "";
  } catch {}

  let message;
  if (response.status === 401) message = "Canvas rejected the access token. Save a valid token in extension settings.";
  else if (response.status === 403) message = "Canvas denied access to this resource.";
  else if (response.status === 404) message = "Canvas resource was not found.";
  else if (response.status === 429) message = "Canvas rate limit reached. Try the request again shortly.";
  else message = `Canvas returned HTTP ${response.status}.`;

  if (detail) message += ` ${detail}`;
  return new CanvasApiError(message, { status: response.status, endpoint });
}
