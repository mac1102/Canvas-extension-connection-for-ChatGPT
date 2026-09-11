export const OPERATIONS = Object.freeze([
  "list_assignments", "get_assignment", "get_rubric", "list_modules", "get_page",
  "list_files", "get_file", "get_syllabus", "get_announcements", "get_grades",
  "get_todo", "get_submissions", "list_folders", "get_assignment_groups", "get_user"
]);
const string = { type: "string", maxLength: 200 };
const strings = { type: "array", items: string, maxItems: 8 };
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const PLAN_SCHEMA = object({
  version: { type: "integer", enum: [1] },
  course_scope: object({ mode: { type: "string", enum: ["explicit", "current", "all"] }, queries: strings }),
  operations: { type: "array", minItems: 1, maxItems: OPERATIONS.length, items: object({
    type: { type: "string", enum: OPERATIONS }, query: { type: ["string", "null"], maxLength: 200 },
    resource_ids: { type: "array", maxItems: 8, items: { type: "string", pattern: "^r[0-9]+$" } }, required: { type: "boolean" }
  }) },
  assignment_filters: object({ search_terms: strings,
    time_window: { type: ["string", "null"], pattern: "^(today|tomorrow|this week|next week|upcoming|overdue|next ([1-9]|[1-5][0-9]|60) days)$" },
    submission_state: { type: ["string", "null"], enum: [null, "submitted", "unsubmitted"] },
    individual: { type: "boolean" }
  }),
  resource_queries: strings, follow_links: { type: "boolean" },
  max_depth: { type: "integer", minimum: 0, maximum: 3 },
  max_resources: { type: "integer", minimum: 1, maximum: 50 }, needs_count: { type: "boolean" }
});
