import { chooseCourseScope, normalizeText } from "../router.js";
export function courseRelevance(course, now = new Date()) {
  const start = Date.parse(course.start_at || course.term?.start_at), end = Date.parse(course.end_at || course.term?.end_at);
  if (Number.isFinite(end) && end < now.getTime()) return -10;
  if (Number.isFinite(start) && start > now.getTime() + 30 * 86400000) return -5;
  if (Number.isFinite(start) && start <= now.getTime() && Number.isFinite(end)) return 10;
  const label = normalizeText(`${course.name} ${course.course_code} ${course.term?.name}`);
  const academicYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear();
  const years = (label.match(/\b20\d{2}\b/g) || []).map(Number);
  if (years.length && Math.max(...years) < academicYear) return -8;
  if (years.length >= 2 && years[1] === years[0] + 1 && years[0] < academicYear) return -8;
  let score = years.includes(academicYear) || years.includes(now.getFullYear()) ? 5 : 0;
  const semester = now.getMonth() >= 8 || now.getMonth() === 0 ? 1 : 2;
  const term = label.match(/(?:semester|sem|s)\s*([12])\b/);
  if (term) score += Number(term[1]) === semester ? 2 : -4;
  const recent = Date.parse(course.last_activity_at || course.updated_at);
  if (Number.isFinite(recent) && Math.abs(now - recent) < 60 * 86400000) score += 2;
  return score;
}
export function selectCourses(query, courses, plan, settings, now = new Date()) {
  const valid = courses.filter((course) => course?.id && course.name);
  const explicit = chooseCourseScope(query, valid);
  if (explicit.matched) return { courses: explicit.courses, matched: true, reason: "explicit course" };
  if (plan.course_scope.mode === "explicit") {
    const requested = plan.course_scope.queries.flatMap((q) => { const scope = chooseCourseScope(q, valid); return scope.matched ? scope.courses : []; });
    return { courses: [...new Map(requested.map((c) => [c.id, c])).values()], matched: true, reason: requested.length ? "planned course" : "named course not found" };
  }
  if (plan.course_scope.mode === "all" || settings.currentCoursesOnly === false) return { courses: valid, matched: false, reason: "all courses requested" };
  const ranked = valid.map((course) => ({ course, score: courseRelevance(course, now) })).sort((a, b) => b.score - a.score);
  const threshold = ranked[0]?.score > 0 ? 1 : 0;
  return { courses: ranked.filter((entry) => entry.score >= threshold).slice(0, 8).map((entry) => entry.course), matched: false, reason: "current course relevance (dates, academic year, semester, activity); uncertain courses may be omitted" };
}
