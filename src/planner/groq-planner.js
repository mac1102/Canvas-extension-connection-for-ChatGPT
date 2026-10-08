import { PLAN_SCHEMA } from "./planner-schema.js";
import { validatePlan } from "./plan-validator.js";
import { plannerPayload } from "../privacy/privacy-guard.js";
export const GROQ_MODEL = "openai/gpt-oss-20b";
export async function groqPlan({ query, apiKey, secrets = [], fetchImpl = fetch, timeoutMs = 8000 }) {
  const payload = plannerPayload({ query }, [...secrets, apiKey]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    let timer;
    try {
      const work = (async () => {
        const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: GROQ_MODEL, temperature: 0, reasoning_effort: attempt ? "medium" : "low",
            max_completion_tokens: attempt ? 1000 : 700, stream: false,
            response_format: { type: "json_schema", json_schema: { name: "retrieval_plan", strict: true, schema: PLAN_SCHEMA } },
            messages: [{ role: "system", content: "Decide which read-only Canvas resources are needed to answer the user's meaning; do not answer the question. Preserve every intent. For classes, timetable, or what the user will study today/tomorrow/this week, use get_calendar_events with its query set to the requested time window, also select list_modules, get_page and get_file with follow_links=true to read dated module sections and their linked learning materials when the calendar is empty. Module dates and weekday headings are learning-topic evidence; never invent class times or rooms. Resource discovery can use module page_url/content_id even when global Page or Files listings are inaccessible. An assignment due date is not a class schedule. Set assignment_filters.time_window only when filtering assignment deadlines; a study date alone must not restrict assignments to those due that day. assignment_filters.search_terms are genuine assignment title/topic restrictions: use [] for broad requests. Never use conversational words such as fetch, gonna, study, or today as assignment title filters. Explicitly set every filter; empty means no restriction. Count needs complete list_assignments; requirements need get_assignment and get_rubric and follow_links. Reading/manual requests may need list_modules, list_files, get_file, get_page, get_syllabus. Resource discovery and following links are bounded. resource_ids must be empty before discovery. Use current scope unless a course is explicitly named. Never invent IDs." },
              { role: "user", content: JSON.stringify(payload) }]
          })
        });
        if (!response.ok) { const error = new Error(`Groq HTTP ${response.status}`); error.http = true; throw error; }
        const data = await response.json();
        if (data.choices?.[0]?.finish_reason !== "stop") throw new Error("Invalid planner output");
        return validatePlan(JSON.parse(data.choices[0].message.content));
      })();
      return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); const e = new Error("Groq timeout"); e.http = true; reject(e); }, timeoutMs); })]);
    } catch (error) {
      if (error.http || error.name === "AbortError" || attempt) throw new Error(error.http ? error.message : "Invalid planner output");
    } finally { clearTimeout(timer); }
  }
}
