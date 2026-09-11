import { readableText } from "../retrieval/html.js";
import { normalizeText } from "../router.js";
export function excerpts(text, query, { maxChunks = 3, chunkSize = 1000 } = {}) {
  const chunks = []; const input = String(text || "");
  const tokens = [...new Set(normalizeText(query).split(" ").filter((s) => s.length > 2))];
  for (let start = 0; start < input.length; start += chunkSize) {
    const value = input.slice(start, start + chunkSize), normalized = normalizeText(value);
    const score = tokens.reduce((sum, token) => sum + (normalized.includes(token) ? 1 : 0), 0);
    chunks.push({ excerpt: value, offset: start, score, truncated: input.length > value.length });
  }
  return chunks.sort((a, b) => b.score - a.score || a.offset - b.offset).slice(0, maxChunks);
}
export function assignmentSummary(item) {
  return { id: item.id, name: item.name, due_at: item.due_at || null, points: item.points_possible ?? null,
    status: item.submission?.workflow_state || null, submitted_at: item.submission?.submitted_at || null,
    missing: item.submission?.missing ?? null, late: item.submission?.late ?? null };
}
export function rubricSummary(rubric = []) {
  return rubric.slice(0, 30).map((r) => ({ description: readableText(r.description), details: excerpts(readableText(r.long_description), r.description || ""), points: r.points,
    ratings: (r.ratings || []).slice(0, 10).map((rating) => ({ description: readableText(rating.description), details: excerpts(readableText(rating.long_description), rating.description || ""), points: rating.points })) }));
}
