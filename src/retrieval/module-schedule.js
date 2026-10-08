import { parseTimeWindow } from "../router.js";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join("|");
const RANGE = new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?\\s*[-–—]\\s*(?:(${MONTH})\\.?\\s+)?(\\d{1,2})(?:,?\\s+(20\\d{2}))?\\b`, "i");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function date(year, month, day) {
  const value = new Date(year, month, day);
  return value.getFullYear() === year && value.getMonth() === month && value.getDate() === day ? value : null;
}
// Only explicit month/day ranges count as schedule evidence. "Week 6" alone does not.
export function moduleDateRange(title, window, course = {}) {
  const match = String(title || "").match(RANGE);
  if (!match) return null;
  const month = (s) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3)));
  const first = month(match[1]), last = match[4] ? month(match[4]) : first;
  const rollover = last < first;
  const explicitYear = match[3] ? Number(match[3]) : match[6] ? Number(match[6]) - Number(rollover) : null;
  const years = explicitYear ? [explicitYear] : [-1, 0, 1].map((offset) => window.start.getFullYear() + offset);
  const ranges = years.flatMap((year) => {
    const start = date(year, first, Number(match[2]));
    const end = date(match[6] ? Number(match[6]) : year + Number(rollover), last, Number(match[5]));
    if (!start || !end || end < start || end - start > 31 * 86400000) return [];
    end.setHours(23, 59, 59, 999);
    const courseStart = Date.parse(course.start_at), courseEnd = Date.parse(course.end_at);
    if ((Number.isFinite(courseStart) && end < courseStart) || (Number.isFinite(courseEnd) && start > courseEnd)) return [];
    return [{ start, end, inferredYear: !explicitYear }];
  });
  return ranges.sort((a, b) => Math.abs(a.start - window.start) - Math.abs(b.start - window.start))[0] || null;
}
export function studyWindow(query, plan, now) {
  const op = plan.operations.find((item) => item.type === "get_calendar_events");
  return parseTimeWindow(op?.query || query, now);
}
export function selectModuleSchedule(groups, window) {
  const schedules = [], resources = new Set();
  for (const { module, course, items, complete } of groups) {
    const range = moduleDateRange(module.name, window, course);
    if (!range || range.end < window.start || range.start > window.end) continue;
    let section = null;
    const days = [];
    for (const item of items) {
      const heading = String(item.title || "").trim().replace(/:$/, "");
      const day = DAYS.findIndex((name) => name.toLowerCase() === heading.toLowerCase());
      if (day >= 0 && (item.type === "SubHeader" || (!item.content_id && !item.page_url))) {
        const at = new Date(range.start);
        at.setDate(at.getDate() + (day - at.getDay() + 7) % 7);
        // A weekday is ambiguous when the module range spans more than one week.
        section = at <= range.end && range.end - range.start < 7 * 86400000 && at <= window.end &&
          dateKey(at) >= dateKey(window.start) ? { date: dateKey(at), weekday: DAYS[day], items: [] } : null;
        if (section) days.push(section);
        continue;
      }
      if (item.type === "SubHeader") { section = null; continue; }
      if (!section || item.published === false) continue;
      section.items.push({ id: item.id, title: item.title, item_type: item.type,
        content_id: item.content_id, page_url: item.page_url, url: item.html_url,
        resource_id: item.resourceNode?.local_id });
      if (item.resourceNode) resources.add(item.resourceNode.local_id);
    }
    schedules.push({ kind: "module_schedule", priority: 97, course_id: course.id,
      module_id: module.id, module: module.name, complete,
      date_range: { start: dateKey(range.start), end: dateKey(range.end), year_inferred: range.inferredYear },
      days, source_url: `https://canvas.uva.nl/courses/${course.id}/modules/${module.id}`,
      evidence: "Module month/day range and weekday headings; year inferred from the selected course/request date when absent.",
      limitation: "Module topics are evidence of planned learning. They do not establish class times, rooms or timetable changes." });
  }
  return { schedules, resources };
}
