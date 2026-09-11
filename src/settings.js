export const DEFAULT_SETTINGS = Object.freeze({
  baseUrl: "https://canvas.uva.nl", timeoutMs: 15000, maxContextChars: 18000,
  includeDescriptions: true, includeSubmitted: true, currentCoursesOnly: true,
  groqEnabled: false, plannerMode: "hybrid", maxDocumentBytes: 8 * 1024 * 1024,
  maxDepth: 2, maxResources: 30, debug: false
});
export function sanitizeSettings(input = {}) {
  const result = { ...DEFAULT_SETTINGS };
  for (const key of ["includeDescriptions", "includeSubmitted", "currentCoursesOnly", "groqEnabled", "debug"]) {
    if (typeof input[key] === "boolean") result[key] = input[key];
  }
  for (const [key, min, max] of [["timeoutMs", 3000, 15000], ["maxContextChars", 2000, 30000],
    ["maxDocumentBytes", 1048576, 16777216], ["maxDepth", 0, 3], ["maxResources", 1, 50]]) {
    if (Number.isFinite(Number(input[key]))) result[key] = Math.round(Math.max(min, Math.min(max, Number(input[key]))));
  }
  if (["local", "hybrid", "preferred"].includes(input.plannerMode)) result.plannerMode = input.plannerMode;
  return result;
}
