import { CanvasClient, CanvasApiError } from "./canvas-client.js";
import {
  assignmentMatchesSearchTerms,
  chooseCourseScope,
  detectIntent,
  extractAssignmentSearchTerms,
  extractResourceSearchTerms,
  parseTimeWindow,
  rankAssignments,
  resourceMatchesSearchTerms
} from "./router.js";

const DEFAULT_SETTINGS = Object.freeze({
  baseUrl: "https://canvas.uva.nl",
  timeoutMs: 15000,
  maxContextChars: 18000,
  includeDescriptions: true,
  includeSubmitted: true,
  debug: false
});

initializeStorageSecurity();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await initializeStorageSecurity();
  const existing = await chrome.storage.local.get(["settings"]);
  if (!existing.settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  if (reason === "install") await chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(initializeStorageSecurity);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      log("error", error);
      sendResponse({ ok: false, error: serializeError(error) });
    });
  return true;
});

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") throw new Error("Invalid extension message.");
  validateSender(message.type, sender);

  switch (message.type) {
    case "GET_STATUS":
      return getStatus();
    case "SAVE_SETTINGS":
      return saveSettings(message.payload || {});
    case "CLEAR_TOKEN":
      await chrome.storage.local.remove("canvasToken");
      return { configured: false };
    case "TEST_CONNECTION":
      return testConnection();
    case "FETCH_CANVAS_CONTEXT":
      return fetchCanvasContext(String(message.query || ""));
    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

function validateSender(type, sender) {
  const url = sender?.url || "";
  const isExtensionPage = url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  const isChatGpt = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
  const contentAllowed = new Set(["FETCH_CANVAS_CONTEXT", "GET_STATUS"]);

  if (isExtensionPage) return;
  if (isChatGpt && contentAllowed.has(type)) return;
  throw new Error("Rejected message from an unauthorized context.");
}

async function initializeStorageSecurity() {
  try {
    if (chrome.storage?.local?.setAccessLevel) {
      await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    }
  } catch (error) {
    console.warn("Canvas Live: could not restrict storage access level", error);
  }
}

async function getStoredConfig() {
  const stored = await chrome.storage.local.get(["canvasToken", "settings", "lastConnection"]);
  return {
    token: stored.canvasToken || "",
    settings: { ...DEFAULT_SETTINGS, ...(stored.settings || {}) },
    lastConnection: stored.lastConnection || null
  };
}

async function getStatus() {
  const { token, settings, lastConnection } = await getStoredConfig();
  return {
    configured: Boolean(token),
    baseUrl: settings.baseUrl,
    lastConnection,
    settings: {
      timeoutMs: settings.timeoutMs,
      maxContextChars: settings.maxContextChars,
      includeDescriptions: settings.includeDescriptions,
      includeSubmitted: settings.includeSubmitted,
      debug: settings.debug
    }
  };
}

async function saveSettings(payload) {
  const existing = await getStoredConfig();
  const next = sanitizeSettings({ ...existing.settings, ...(payload.settings || {}) });
  const updates = { settings: next };

  if (typeof payload.token === "string" && payload.token.trim()) {
    updates.canvasToken = payload.token.trim();
  }
  await chrome.storage.local.set(updates);

  return {
    configured: Boolean(updates.canvasToken || existing.token),
    settings: next
  };
}

function sanitizeSettings(input) {
  return {
    baseUrl: "https://canvas.uva.nl",
    timeoutMs: clampNumber(input.timeoutMs, 3000, 30000, DEFAULT_SETTINGS.timeoutMs),
    maxContextChars: clampNumber(input.maxContextChars, 6000, 30000, DEFAULT_SETTINGS.maxContextChars),
    includeDescriptions: input.includeDescriptions !== false,
    includeSubmitted: input.includeSubmitted !== false,
    debug: Boolean(input.debug)
  };
}

async function getClient() {
  const { token, settings } = await getStoredConfig();
  if (!token) throw new CanvasApiError("Canvas access token is not configured. Open extension settings first.");
  return {
    client: new CanvasClient({ token, baseUrl: settings.baseUrl, timeoutMs: settings.timeoutMs }),
    settings
  };
}

async function testConnection() {
  const { client } = await getClient();
  const user = await client.getCurrentUser();
  const lastConnection = {
    ok: true,
    at: new Date().toISOString(),
    user: { id: user?.id, name: user?.name, short_name: user?.short_name }
  };
  await chrome.storage.local.set({ lastConnection });
  return { user: lastConnection.user, checkedAt: lastConnection.at };
}

async function fetchCanvasContext(query) {
  if (!query.trim()) throw new Error("The @Canvas request is empty.");
  const startedAt = Date.now();
  const fetchedAt = new Date();
  const { client, settings } = await getClient();
  const intents = detectIntent(query);

  const courses = sanitizeCourses(await client.getActiveCourses());
  const scope = chooseCourseScope(query, courses);
  const scopedCourses = scope.courses.slice(0, scope.matched ? 3 : 12);
  const sections = [];

  sections.push({
    title: "Request routing",
    data: {
      intents,
      course_scope: scope.matched ? scopedCourses.map(courseLabel) : "all active courses",
      freshness: fetchedAt.toISOString()
    }
  });

  if (intents.includes("dashboard")) {
    const todo = await client.getTodo();
    sections.push({ title: "Canvas todo", data: formatTodo(todo, courses, settings) });
    sections.push({ title: "Active courses", data: courses.map(compactCourse) });
  }

  if (
    intents.includes("assignments") &&
    !intents.includes("assignmentDetail") &&
    !intents.includes("deadlines")
  ) {
    await addAssignmentListContext({ client, query, scopedCourses, scope, settings, sections });
  }

  if (intents.includes("deadlines")) {
    await addDeadlineContext({ client, query, courses, scopedCourses, scope, settings, sections });
  }

  if (intents.includes("assignmentDetail")) {
    await addAssignmentDetailContext({ client, query, scopedCourses, settings, sections });
  }

  if (intents.includes("announcements")) {
    const window = parseAnnouncementWindow(query);
    const announcements = await client.getAnnouncements(scopedCourses.map((course) => course.id), {
      startDate: window.start,
      endDate: window.end
    });
    sections.push({
      title: `Announcements (${window.label})`,
      data: announcements.slice(0, 40).map((item) => compactAnnouncement(item, courses, settings))
    });
  }

  if (intents.includes("grades")) {
    const enrollments = await client.getEnrollments();
    const allowedIds = new Set(scopedCourses.map((course) => course.id));
    sections.push({
      title: "Grades / enrollment scores",
      data: enrollments
        .filter((item) => !scope.matched || allowedIds.has(item.course_id))
        .map((item) => compactEnrollment(item, courses))
    });
  }

  if (intents.includes("files")) {
    await addResourceContext({ client, query, scopedCourses, settings, sections });
  }

  if (intents.includes("modules")) {
    const moduleResults = await mapWithConcurrency(scopedCourses.slice(0, 4), 3, async (course) => ({
      course: courseLabel(course),
      modules: (await client.getModules(course.id)).map(compactModule)
    }));
    sections.push({ title: "Course modules", data: moduleResults });
  }

  if (sections.length === 1) {
    sections.push({ title: "Active courses", data: courses.map(compactCourse) });
    sections.push({ title: "Canvas todo", data: formatTodo(await client.getTodo(), courses, settings) });
  }

  const context = buildContextText({ query, fetchedAt, sections, maxChars: settings.maxContextChars });
  const durationMs = Date.now() - startedAt;
  await chrome.storage.local.set({
    lastConnection: {
      ok: true,
      at: fetchedAt.toISOString(),
      user: null,
      lastFetchDurationMs: durationMs
    }
  });

  log("debug", { query, intents, courseCount: courses.length, durationMs, contextChars: context.length });
  return {
    context,
    meta: {
      fetchedAt: fetchedAt.toISOString(),
      durationMs,
      intents,
      matchedCourses: scope.matched ? scopedCourses.map(courseLabel) : [],
      contextChars: context.length
    }
  };
}

async function addAssignmentListContext({ client, query, scopedCourses, scope, settings, sections }) {
  const targetCourses = scopedCourses.slice(0, scope.matched ? 3 : 8);
  const searchTerms = extractAssignmentSearchTerms(query, scope.matched ? targetCourses : []);
  const results = await mapWithConcurrency(targetCourses, 3, async (course) => {
    const assignments = await client.getAssignments(course.id);
    const filtered = assignments
      .filter((item) => settings.includeSubmitted || !item?.submission?.submitted_at)
      .filter((item) => assignmentMatchesSearchTerms(item?.name || "", searchTerms));

    return {
      course: courseLabel(course),
      search_terms: searchTerms,
      assignments: filtered.slice(0, 100).map((item) => compactAssignmentListItem(item))
    };
  });

  sections.push({
    title: searchTerms.length
      ? "Assignments matching request"
      : (scope.matched ? "Assignments for matched course" : "Assignments across active courses"),
    data: results
  });
}

async function addResourceContext({ client, query, scopedCourses, settings, sections }) {
  const targetCourses = scopedCourses.slice(0, 4);
  const searchTerms = extractResourceSearchTerms(query, targetCourses);

  const results = await mapWithConcurrency(targetCourses, 2, async (course) => {
    const [details, files, pages] = await Promise.all([
      client.getCourseDetails(course.id),
      client.getFiles(course.id),
      client.getPages(course.id)
    ]);

    const matchingFiles = files
      .filter((file) => resourceMatchesSearchTerms(
        [file?.display_name, file?.filename].filter(Boolean).join(" "),
        searchTerms
      ))
      .slice(0, 12);

    const matchingPages = pages
      .filter((page) => resourceMatchesSearchTerms(
        [page?.title, page?.url].filter(Boolean).join(" "),
        searchTerms
      ))
      .slice(0, 8);

    const fullPages = await mapWithConcurrency(matchingPages, 2, async (page) => {
      const full = await client.getPage(course.id, page.url);
      return {
        title: full?.title,
        url: full?.url,
        updated_at: full?.updated_at,
        html_url: full?.html_url,
        body: settings.includeDescriptions ? truncate(cleanHtml(full?.body || ""), 5000) : undefined
      };
    });

    const enrichedFiles = await mapWithConcurrency(matchingFiles, 2, async (file) => {
      let extracted = null;
      try {
        extracted = await client.getReadableFileText(file, 7000);
      } catch (error) {
        extracted = { readable: false, reason: error?.message || String(error) };
      }

      return {
        ...compactFile(file),
        extracted_text: extracted?.readable ? extracted.text : undefined,
        readable_in_extension: Boolean(extracted?.readable),
        unreadable_reason: extracted?.readable ? undefined : extracted?.reason
      };
    });

    const syllabus = details?.syllabus_body
      ? {
          course: courseLabel(course),
          body: truncate(cleanHtml(details.syllabus_body), 7000)
        }
      : null;

    return {
      course: courseLabel(course),
      search_terms: searchTerms,
      syllabus,
      pages: fullPages,
      files: enrichedFiles
    };
  });

  sections.push({
    title: "Course resources (syllabus, pages, files)",
    data: results
  });
}

async function addDeadlineContext({ client, query, courses, scopedCourses, scope, settings, sections }) {
  const window = parseTimeWindow(query);
  const todo = await client.getTodo();
  const filteredTodo = formatTodo(todo, courses, settings).filter((item) => {
    if (!item.due_at) return true;
    const due = new Date(item.due_at);
    return due >= window.start && due <= window.end;
  });
  sections.push({ title: `Todo / deadlines (${window.label})`, data: filteredTodo });

  const shouldFetchAssignments = scope.matched || /all assignments|assignment|bai tap|bài tập|chua nop|chưa nộp/i.test(query);
  if (!shouldFetchAssignments) return;

  const targetCourses = (scope.matched ? scopedCourses : courses).slice(0, scope.matched ? 3 : 8);
  const results = await mapWithConcurrency(targetCourses, 3, async (course) => {
    const assignments = await client.getAssignments(course.id);
    return {
      course: courseLabel(course),
      assignments: assignments
        .filter((item) => settings.includeSubmitted || !item?.submission?.submitted_at)
        .filter((item) => {
          if (!item.due_at) return false;
          const due = new Date(item.due_at);
          return due >= window.start && due <= window.end;
        })
        .slice(0, 60)
        .map((item) => compactAssignment(item, settings))
    };
  });
  sections.push({ title: `Assignments (${window.label})`, data: results });
}

async function addAssignmentDetailContext({ client, query, scopedCourses, settings, sections }) {
  const targetCourses = scopedCourses.slice(0, 4);
  const candidates = [];

  await mapWithConcurrency(targetCourses, 3, async (course) => {
    const assignments = await client.getAssignments(course.id);
    for (const ranked of rankAssignments(query, assignments, 5)) {
      candidates.push({ ...ranked, course });
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (best && best.score >= 0.28) {
    const full = await client.getAssignment(best.course.id, best.assignment.id);
    sections.push({
      title: "Best matching assignment detail",
      data: {
        course: courseLabel(best.course),
        match_score: Number(best.score.toFixed(3)),
        assignment: compactAssignment(full, settings, true)
      }
    });
    return;
  }

  sections.push({
    title: "Possible matching assignments",
    data: candidates.slice(0, 10).map(({ course, assignment, score }) => ({
      course: courseLabel(course),
      match_score: Number(score.toFixed(3)),
      assignment: compactAssignment(assignment, settings)
    }))
  });
}

function sanitizeCourses(courses) {
  return (courses || [])
    .filter((course) => course && course.id && course.name)
    .map((course) => ({
      id: course.id,
      name: course.name,
      course_code: course.course_code,
      original_name: course.original_name,
      start_at: course.start_at,
      end_at: course.end_at,
      workflow_state: course.workflow_state,
      term: course.term,
      enrollments: course.enrollments
    }));
}

function compactCourse(course) {
  const enrollment = Array.isArray(course.enrollments) ? course.enrollments[0] : null;
  return {
    id: course.id,
    name: course.name,
    course_code: course.course_code,
    term: course.term?.name,
    start_at: course.start_at,
    end_at: course.end_at,
    current_score: enrollment?.computed_current_score ?? enrollment?.computed_final_score ?? null,
    current_grade: enrollment?.computed_current_grade ?? enrollment?.computed_final_grade ?? null
  };
}

function compactAssignmentListItem(item) {
  const submission = item?.submission || null;
  return {
    id: item?.id,
    name: item?.name,
    due_at: item?.due_at,
    points_possible: item?.points_possible,
    html_url: item?.html_url,
    status: submission?.workflow_state || null,
    submitted_at: submission?.submitted_at || null,
    missing: submission?.missing ?? null,
    late: submission?.late ?? null
  };
}

function compactAssignment(item, settings, full = false) {
  const submission = item?.submission || null;
  const output = {
    id: item?.id,
    name: item?.name,
    due_at: item?.due_at,
    unlock_at: item?.unlock_at,
    lock_at: item?.lock_at,
    points_possible: item?.points_possible,
    grading_type: item?.grading_type,
    submission_types: item?.submission_types,
    allowed_extensions: item?.allowed_extensions,
    published: item?.published,
    html_url: item?.html_url,
    submission: submission ? {
      workflow_state: submission.workflow_state,
      submitted_at: submission.submitted_at,
      late: submission.late,
      missing: submission.missing,
      excused: submission.excused,
      grade: submission.grade,
      score: submission.score,
      attempt: submission.attempt
    } : null
  };

  if (settings.includeDescriptions && (full || item?.description)) {
    output.description = truncate(cleanHtml(item?.description || ""), full ? 6500 : 1800);
  }
  return output;
}

function compactAnnouncement(item, courses, settings) {
  const contextCourseId = Number(String(item?.context_code || "").replace("course_", ""));
  const course = courses.find((candidate) => candidate.id === contextCourseId);
  return {
    id: item?.id,
    course: course ? courseLabel(course) : item?.context_name,
    title: item?.title,
    posted_at: item?.posted_at,
    delayed_post_at: item?.delayed_post_at,
    html_url: item?.html_url,
    author: item?.author?.display_name,
    message: settings.includeDescriptions ? truncate(cleanHtml(item?.message || ""), 2200) : undefined
  };
}

function compactEnrollment(item, courses) {
  const course = courses.find((candidate) => candidate.id === item.course_id);
  return {
    course: course ? courseLabel(course) : item.course_id,
    enrollment_state: item.enrollment_state,
    current_score: item.grades?.current_score ?? null,
    current_grade: item.grades?.current_grade ?? null,
    final_score: item.grades?.final_score ?? null,
    final_grade: item.grades?.final_grade ?? null,
    current_grading_period_score: item.current_grading_period_scores?.current_score ?? null,
    current_grading_period_grade: item.current_grading_period_scores?.current_grade ?? null
  };
}

function compactFile(item) {
  return {
    id: item?.id,
    display_name: item?.display_name,
    filename: item?.filename,
    content_type: item?.["content-type"],
    size: item?.size,
    updated_at: item?.updated_at,
    locked: item?.locked,
    hidden: item?.hidden,
    url: item?.url
  };
}

function compactModule(item) {
  return {
    id: item?.id,
    name: item?.name,
    position: item?.position,
    unlock_at: item?.unlock_at,
    require_sequential_progress: item?.require_sequential_progress,
    state: item?.state,
    items: (item?.items || []).slice(0, 80).map((entry) => ({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      position: entry.position,
      html_url: entry.html_url,
      content_id: entry.content_id,
      completion_requirement: entry.completion_requirement,
      content_details: entry.content_details
    }))
  };
}

function formatTodo(todo, courses, settings) {
  return (todo || []).slice(0, 100).map((item) => {
    const assignment = item.assignment || {};
    const course = courses.find((candidate) => candidate.id === assignment.course_id);
    return {
      type: item.type,
      course: course ? courseLabel(course) : item.context_name,
      assignment_id: assignment.id,
      assignment: assignment.name || item.assignment?.name,
      due_at: assignment.due_at,
      points_possible: assignment.points_possible,
      html_url: assignment.html_url || item.html_url,
      submitted: Boolean(item.needs_grading_count === 0 && assignment?.submission?.submitted_at),
      description: settings.includeDescriptions ? truncate(cleanHtml(assignment.description || ""), 1000) : undefined
    };
  });
}

function parseAnnouncementWindow(query) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  const normalized = query.toLowerCase();
  let days = 30;
  if (/today|h[oô]m nay/i.test(normalized)) days = 1;
  else if (/week|tu[aầ]n/i.test(normalized)) days = 7;
  start.setDate(start.getDate() - days);
  end.setDate(end.getDate() + 1);
  return { start, end, label: `last ${days} days` };
}

function buildContextText({ query, fetchedAt, sections, maxChars }) {
  const header = [
    "CANVAS_LIVE_CONTEXT_V1",
    `Fetched directly from Canvas at: ${fetchedAt.toISOString()}`,
    `User request: ${query}`,
    "Treat this as fresh external context. Do not claim data that is absent. Canvas timestamps are ISO timestamps and may be UTC.",
    "---"
  ].join("\n");

  let output = header;
  for (const section of sections) {
    const block = `\n## ${section.title}\n${JSON.stringify(section.data, null, 2)}\n`;
    if (output.length + block.length > maxChars) {
      const remaining = maxChars - output.length;
      if (remaining > 300) output += block.slice(0, remaining - 120);
      output += "\n[Context truncated by extension size limit]\n";
      break;
    }
    output += block;
  }
  return output;
}

function cleanHtml(value) {
  return decodeEntities(String(value || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function decodeEntities(value) {
  const entities = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'"
  };
  return value.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (match) => entities[match] || match);
}

function courseLabel(course) {
  return course.course_code ? `${course.name} (${course.course_code})` : course.name;
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.max(min, Math.min(max, number)));
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    status: error?.status || null,
    endpoint: error?.endpoint || null
  };
}

async function log(level, ...args) {
  const { settings } = await getStoredConfig();
  if (level === "error" || settings.debug) console[level === "debug" ? "log" : level]("Canvas Live:", ...args);
}
