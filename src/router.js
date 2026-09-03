const INTENT_KEYWORDS = {
  deadlines: [
    "deadline", "deadlines", "due", "due date", "overdue", "upcoming",
    "today", "tomorrow", "this week", "next week",
    "han", "hạn", "den han", "đến hạn", "qua han", "quá hạn",
    "hom nay", "hôm nay", "ngay mai", "ngày mai", "tuan nay", "tuần này",
    "chua nop", "chưa nộp", "nop bai", "nộp bài"
  ],
  assignments: [
    "assignment", "assignments", "assigment", "assigments",
    "coursework", "tasks", "bai tap", "bài tập"
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
    "documents", "lecture note", "lecture notes", "material", "materials",
    "manual", "course manual", "handbook", "guide", "syllabus", "reader",
    "tai lieu", "tài liệu", "giao trinh", "giáo trình", "de cuong", "đề cương"
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

function canonicalToken(token) {
  const value = normalizeText(token);
  if (value.length > 5 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;

    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }

  if (i < a.length || j < b.length) edits += 1;
  return edits <= 1;
}

function tokenMatches(a, b) {
  const left = canonicalToken(a);
  const right = canonicalToken(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.length >= 6 && right.length >= 6 && editDistanceAtMostOne(left, right);
}

function includesKeyword(normalized, keyword) {
  const normalizedKeyword = normalizeText(keyword);
  if (normalized.includes(normalizedKeyword)) return true;

  const keywordTokens = normalizedKeyword.split(" ").filter(Boolean);
  if (keywordTokens.length !== 1) return false;

  return normalized
    .split(" ")
    .filter(Boolean)
    .some((token) => tokenMatches(token, keywordTokens[0]));
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

  if (intents.includes("assignmentDetail") && !intents.includes("assignments")) {
    intents.push("assignments");
  }

  return [...new Set(intents)];
}

function tokenSet(text) {
  return new Set(
    normalizeText(text)
      .split(" ")
      .filter(Boolean)
      .map(canonicalToken)
  );
}

export function similarityScore(query, candidate) {
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (!q || !c) return 0;
  if (q.includes(c)) return 1;
  if (c.includes(q) && q.length >= 4) return 0.95;

  const qTokens = tokenSet(q);
  const cTokens = tokenSet(c);

  if (cTokens.size === 1) {
    const [onlyCandidateToken] = cTokens;
    if ([...qTokens].some((queryToken) => tokenMatches(queryToken, onlyCandidateToken))) {
      return 0.9;
    }
  }

  let intersection = 0;
  for (const token of cTokens) {
    if ([...qTokens].some((queryToken) => tokenMatches(queryToken, token))) intersection += 1;
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
      const name = course?.name || "";
      const prefix = name.includes(":") ? name.split(":", 1)[0] : name.split(/\s+-\s+/, 1)[0];
      const candidates = [
        name,
        prefix,
        course?.course_code,
        course?.original_name
      ].filter(Boolean);
      const score = Math.max(...candidates.map((candidate) => similarityScore(query, candidate)));
      return { course, score };
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


const RESOURCE_QUERY_STOPWORDS = new Set([
  "canvas", "github", "check", "xem", "tim", "find", "show", "list", "get", "fetch",
  "file", "files", "pdf", "document", "documents", "material", "materials",
  "course", "mon", "tai", "lieu", "giao", "trinh", "de", "cuong",
  "co", "gi", "nao", "la", "cua", "cho", "toi", "minh", "what", "which",
  "the", "a", "an", "of", "in", "for", "my", "me", "please"
]);

export function extractResourceSearchTerms(query, matchedCourses = []) {
  const courseTokens = new Set();

  for (const course of matchedCourses || []) {
    const name = normalizeText(course?.name || "");
    const prefix = name.includes(":") ? name.split(":", 1)[0] : name;
    for (const token of prefix.split(" ").filter(Boolean)) {
      courseTokens.add(canonicalToken(token));
    }
    for (const token of normalizeText(course?.course_code || "").split(" ").filter(Boolean)) {
      courseTokens.add(canonicalToken(token));
    }
  }

  return [...new Set(
    normalizeText(query)
      .split(" ")
      .filter(Boolean)
      .map(canonicalToken)
      .filter((token) => token.length >= 3)
      .filter((token) => !RESOURCE_QUERY_STOPWORDS.has(token))
      .filter((token) => !courseTokens.has(token))
  )];
}

export function resourceMatchesSearchTerms(label, terms) {
  if (!terms?.length) return true;
  const labelTokens = normalizeText(label)
    .split(" ")
    .filter(Boolean)
    .map(canonicalToken);

  return terms.every((term) =>
    labelTokens.some((labelToken) =>
      labelToken === term ||
      labelToken.includes(term) ||
      term.includes(labelToken) ||
      (term.length >= 6 && labelToken.length >= 6 && editDistanceAtMostOne(labelToken, term))
    )
  );
}
