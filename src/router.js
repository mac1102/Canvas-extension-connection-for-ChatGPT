const INTENT_KEYWORDS = {
  deadlines: [
    "deadline", "deadlines", "due", "due date", "overdue", "upcoming",
    "today", "tomorrow", "this week", "next week", "assignment", "assignments",
    "bai tap", "bài tập", "han", "hạn", "den han", "đến hạn", "qua han", "quá hạn",
    "hom nay", "hôm nay", "ngay mai", "ngày mai", "tuan nay", "tuần này",
    "chua nop", "chưa nộp", "nop bai", "nộp bài"
  ],
  assignmentDetail: [
    "instruction", "instructions", "requirement", "requirements", "rubric",
    "description", "details", "what do i do", "how to do", "huong dan", "hướng dẫn",
    "yeu cau", "yêu cầu", "de bai", "đề bài", "noi dung bai", "nội dung bài"
  ],
  announcements: [
    "announcement", "announcements", "notice", "notices", "lecturer posted",
    "teacher posted", "update from lecturer", "thong bao", "thông báo", "giang vien", "giảng viên",
    "moi dang", "mới đăng", "cap nhat", "cập nhật"
  ],
  grades: [
    "grade", "grades", "score", "scores", "mark", "marks", "result", "results",
    "diem", "điểm", "ket qua", "kết quả", "bao nhieu diem", "bao nhiêu điểm"
  ],
  files: [
    "file", "files", "pdf", "slide", "slides", "notebook", "ipynb", "document",
    "documents", "lecture note", "lecture notes", "material", "materials", "tai lieu", "tài liệu"
  ],
  modules: [
    "module", "modules", "lesson", "lessons", "week", "weeks", "content",
    "bai hoc", "bài học", "noi dung mon", "nội dung môn"
  ]
};

export function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function includesKeyword(normalized, keyword) {
  return normalized.includes(normalizeText(keyword));
}

export function detectIntent(query) {
  const normalized = normalizeText(query);
  const scores = {};

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    scores[intent] = keywords.reduce(
      (count, keyword) => count + (includesKeyword(normalized, keyword) ? 1 : 0),
      0
    );
  }

  const intents = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([intent]) => intent);

  if (!intents.length) return ["dashboard"];

  if (intents.includes("assignmentDetail") && !intents.includes("deadlines")) {
    intents.push("deadlines");
  }

  return [...new Set(intents)];
}

function tokenSet(text) {
  return new Set(normalizeText(text).split(" ").filter(Boolean));
}

export function similarityScore(query, candidate) {
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (!q || !c) return 0;
  if (q.includes(c)) return 1;
  if (c.includes(q) && q.length >= 4) return 0.95;

  const qTokens = tokenSet(q);
  const cTokens = tokenSet(c);
  let intersection = 0;
  for (const token of cTokens) {
    if (qTokens.has(token)) intersection += 1;
  }
  const union = new Set([...qTokens, ...cTokens]).size || 1;
  const jaccard = intersection / union;

  let containsBonus = 0;
  for (const token of cTokens) {
    if (token.length >= 4 && q.includes(token)) containsBonus += 0.08;
  }

  return Math.min(0.94, jaccard + containsBonus);
}

export function rankCourses(query, courses, limit = 3) {
  return (courses || [])
    .map((course) => {
      const labels = [course?.name, course?.course_code, course?.original_name]
        .filter(Boolean)
        .join(" ");
      return { course, score: similarityScore(query, labels) };
    })
    .filter(({ score }) => score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function rankAssignments(query, assignments, limit = 5) {
  return (assignments || [])
    .map((assignment) => ({
      assignment,
      score: similarityScore(query, assignment?.name || "")
    }))
    .filter(({ score }) => score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function parseTimeWindow(query, now = new Date()) {
  const normalized = normalizeText(query);
  const start = new Date(now);
  const end = new Date(now);

  if (includesKeyword(normalized, "today") || includesKeyword(normalized, "hom nay")) {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, label: "today" };
  }

  if (includesKeyword(normalized, "tomorrow") || includesKeyword(normalized, "ngay mai")) {
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setHours(23, 59, 59, 999);
    return { start, end, label: "tomorrow" };
  }

  if (includesKeyword(normalized, "next week")) {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() + (8 - day));
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end, label: "next week" };
  }

  if (includesKeyword(normalized, "this week") || includesKeyword(normalized, "tuan nay")) {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end, label: "this week" };
  }

  const daysMatch = normalized.match(/(?:next|trong)\s+(\d{1,2})\s+(?:days?|ngay)/);
  const days = daysMatch ? Math.min(60, Math.max(1, Number(daysMatch[1]))) : 14;
  end.setDate(end.getDate() + days);
  return { start, end, label: `next ${days} days` };
}

export function chooseCourseScope(query, courses) {
  const ranked = rankCourses(query, courses, 3);
  if (!ranked.length) return { courses, matched: false };
  if (ranked[0].score >= 0.42) {
    const best = ranked[0].score;
    const close = ranked.filter((item) => best - item.score <= 0.12);
    return { courses: close.map((item) => item.course), matched: true };
  }
  return { courses, matched: false };
}
