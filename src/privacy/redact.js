export function redact(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[REDACTED]");
  return text.replace(/\b(?:gsk_|sk-)[a-zA-Z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [REDACTED]")
    .replace(/https?:\/\/[^\s<>"\\]+/gi, (raw) => {
      try { const url = new URL(raw); return url.search || url.username || url.password ? `${url.origin}${url.pathname}` : raw; } catch { return "[URL]"; }
    });
}
export function plannerLog(meta) {
  return Object.fromEntries(["planner", "confidence", "complexity", "operations", "fallback", "courses", "assignmentsScanned", "matches", "resourcesFetched", "documentsParsed", "durationMs"]
    .filter((key) => meta[key] !== undefined).map((key) => [key, meta[key]]));
}
