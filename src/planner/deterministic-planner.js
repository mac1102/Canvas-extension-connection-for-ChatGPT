import { detectIntent, normalizeText, parseTimeWindow } from "../router.js";
export function deterministicPlan(query) {
  const q = normalizeText(query), intents = detectIntent(query);
  const types = new Set();
  const add = (...items) => items.forEach((item) => types.add(item));
  const reading = /can doc|need to read|reading|lien quan|related|linked/.test(q);
  const detail = intents.includes("assignmentDetail");
  const manual = /manual|handbook|syllabus|course guide|study guide|reader/.test(q);
  if (intents.includes("assignments") || detail || reading) add("list_assignments");
  if (detail && !manual) add("get_assignment", "get_rubric");
  if (intents.includes("deadlines")) add("list_assignments");
  if (intents.includes("grades") && !manual) add("get_grades");
  if (intents.includes("announcements")) add("get_announcements");
  if (intents.includes("files") || reading || manual) add("list_files", "get_file", "get_page", "get_syllabus", "list_modules");
  if (intents.includes("modules") && !intents.includes("deadlines")) add("list_modules");
  if (/submission|bai da nop/.test(q)) add("get_submissions", "list_assignments");
  if (/folder|thu muc/.test(q)) add("list_folders");
  if (/assignment group/.test(q)) add("get_assignment_groups");
  if (/who am i|tai khoan/.test(q)) add("get_user");
  if (!types.size) add("get_todo");
  const needsCount = /bao nhieu|how many|count|total/.test(q);
  if (needsCount && types.has("list_assignments")) add("list_assignments");
  const time = (intents.includes("deadlines") || /tuan sau|next week|(?:next|trong) \d{1,2} (?:days?|ngay)/.test(q)) ? (/overdue|qua han/.test(q) ? "overdue" : parseTimeWindow(query).label) : null;
  if (time) { types.delete("get_todo"); add("list_assignments"); }
  const plan = {
    version: 1, course_scope: { mode: /all courses|historical|old courses|cac mon cu/.test(q) ? "all" : "current", queries: [] },
    operations: [...types].map((type) => ({ type, query: null, resource_ids: [], required: ["list_assignments", "get_todo"].includes(type) })),
    assignment_filters: { search_terms: [], time_window: time?.startsWith("next 14") ? "upcoming" : time,
      submission_state: /unsubmitted|chua nop|pending/.test(q) ? "unsubmitted" : /submitted|da nop/.test(q) ? "submitted" : null,
      individual: /individual|ca nhan|solo/.test(q) },
    resource_queries: manual ? ["course manual"] : [], follow_links: detail || reading || manual,
    max_depth: 3, max_resources: 50, needs_count: needsCount
  };
  const complexity = Math.min(1, (detail ? 0.4 : 0) + (reading ? 0.7 : 0) + (needsCount ? 0.25 : 0) + (types.size > 3 ? 0.25 : 0) + (intents.includes("dashboard") ? 0.7 : 0));
  return { plan, confidence: Math.max(0.25, 0.98 - complexity * 0.6), complexity };
}
