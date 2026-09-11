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
            messages: [{ role: "system", content: "Convert the user request to a read-only Canvas retrieval plan. Preserve every intent. Count needs complete list_assignments; requirements need get_assignment and get_rubric and follow_links. Reading/manual requests need list_modules, list_files, get_file, get_page, get_syllabus. resource_ids must be empty before discovery. Use current scope unless a course is explicitly named. Never invent IDs. Do not answer the request." },
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
