import { deterministicPlan } from "./deterministic-planner.js";
import { groqPlan, GROQ_MODEL } from "./groq-planner.js";
import { validatePlan } from "./plan-validator.js";
export async function planRequest(query, settings, credentials = {}, dependencies = {}) {
  if (settings.groqEnabled && credentials.apiKey && settings.plannerMode !== "local") {
    try {
      // A validated AI plan owns operations and filters, including empty filters.
      // Do not merge keyword-derived operations back into its semantic decision.
      const plan = await groqPlan({ query, ...credentials, ...dependencies });
      return { plan: validatePlan(plan), meta: { planner: "Groq / " + GROQ_MODEL } };
    } catch (error) {
      const local = deterministicPlan(query);
      return { plan: validatePlan(local.plan), meta: {
        planner: "local", confidence: local.confidence, complexity: local.complexity,
        fallback: error.name === "PrivacyError" ? "privacy firewall" :
          /^Groq HTTP \d+$|^Groq timeout$/.test(error.message) ? error.message : "invalid or unavailable planner"
      } };
    }
  }
  const local = deterministicPlan(query);
  return { plan: validatePlan(local.plan), meta: {
    planner: "local", confidence: local.confidence, complexity: local.complexity,
    fallback: settings.plannerMode === "local" ? "local only mode" :
      !settings.groqEnabled ? "AI planner disabled" : "Groq key missing"
  } };
}
