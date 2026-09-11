import { deterministicPlan } from "./deterministic-planner.js";
import { groqPlan } from "./groq-planner.js";
import { validatePlan } from "./plan-validator.js";
export async function planRequest(query, settings, credentials = {}, dependencies = {}) {
  const local = deterministicPlan(query);
  const meta = { planner: "local", confidence: local.confidence, complexity: local.complexity };
  if (settings.groqEnabled && credentials.apiKey && settings.plannerMode !== "local" && (settings.plannerMode === "preferred" || local.complexity >= 0.4)) {
    try {
      const plan = await groqPlan({ query, ...credentials, ...dependencies });
      // An AI plan may enrich the local plan but must not suppress deterministic multi-intent obligations.
      for (const op of local.plan.operations) if (!plan.operations.some((item) => item.type === op.type)) plan.operations.push(op);
      plan.needs_count ||= local.plan.needs_count;
      plan.follow_links ||= local.plan.follow_links;
      plan.assignment_filters.individual ||= local.plan.assignment_filters.individual;
      plan.assignment_filters.time_window ||= local.plan.assignment_filters.time_window;
      plan.assignment_filters.submission_state ||= local.plan.assignment_filters.submission_state;
      return { plan: validatePlan(plan), meta: { ...meta, planner: "Groq / openai/gpt-oss-20b" } };
    } catch (error) { meta.fallback = error.name === "PrivacyError" ? "privacy firewall" : /^Groq HTTP \d+$|^Groq timeout$/.test(error.message) ? error.message : "invalid or unavailable planner"; }
  }
  return { plan: validatePlan(local.plan), meta };
}
