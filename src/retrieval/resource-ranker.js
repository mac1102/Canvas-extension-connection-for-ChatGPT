import { normalizeText, similarityScore } from "../router.js";
export function resourceScore(query, node, { distance, sameModule = false, now = new Date() } = {}) {
  const q = normalizeText(query), title = normalizeText(node.title || node.name || node.filename);
  let score = similarityScore(q, title) * 10;
  if (/manual|handbook|syllabus|reader|course guide|study guide/.test(q) && /manual|handbook|syllabus|reader|course guide|study guide/.test(title)) score += 12;
  if (/requirements|grading|assessment|rubric|yeu cau/.test(q) && /requirements|grading|assessment|rubric/.test(title)) score += 5;
  if (/individual|ca nhan|solo/.test(q) && /individual|solo|personal/.test(title)) score += 8;
  if (distance !== undefined) score += Math.max(20, 60 - distance * 10);
  if (sameModule) score += 15;
  if (node.type === "Syllabus") score += 1;
  const date = Date.parse(node.updated_at); if (Number.isFinite(date) && Math.abs(now - date) < 90 * 86400000) score += 0.5;
  return score;
}
