import { OPERATIONS } from "../planner/planner-schema.js";
import { redact } from "./redact.js";
export class PrivacyError extends Error { constructor() { super("Query contains sensitive or pasted content; using local planner."); this.name = "PrivacyError"; } }
// Deliberately accepts no metadata or Canvas object. Reject extra fields, including nested API data.
export function plannerPayload(input, secrets = []) {
  if (!input || Object.keys(input).some((key) => key !== "query") || typeof input.query !== "string") throw new PrivacyError();
  const query = input.query.trim();
  if (!query || query.length > 1200 || query.includes("\n") || /[<>{}]|<<<|CANVAS_LIVE_CONTEXT|\b(?:description|feedback|submission|grade|score|student.?id|email)\s*[:=]/i.test(query)
    || /\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\b\d{7,}\b|\b[a-zA-Z0-9_-]{40,}\b/.test(query)
    || redact(query, secrets) !== query || /https?:\/\//i.test(query)) throw new PrivacyError();
  return { query, available_operations: [...OPERATIONS] };
}
