import { PLAN_SCHEMA } from "./planner-schema.js";
export function validatePlan(plan) {
  function check(value, schema) {
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const types = [].concat(schema.type);
    if (!(types.includes(type) || (types.includes("integer") && Number.isInteger(value)))) throw new Error("Invalid plan type");
    if (schema.enum && !schema.enum.includes(value)) throw new Error("Invalid plan value");
    if (type === "object") {
      if (Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))) throw new Error("Unknown plan field");
      for (const key of schema.required) { if (!Object.hasOwn(value, key)) throw new Error("Missing plan field"); check(value[key], schema.properties[key]); }
    }
    if (type === "array") {
      if (value.length < (schema.minItems || 0) || value.length > schema.maxItems) throw new Error("Plan array limit");
      value.forEach((item) => check(item, schema.items));
    }
    if (type === "number" && (value < schema.minimum || value > schema.maximum)) throw new Error("Plan resource limit");
    if (type === "string" && (value.length > schema.maxLength || (schema.pattern && !new RegExp(schema.pattern).test(value)))) throw new Error("Invalid plan string");
  }
  check(plan, PLAN_SCHEMA);
  if (plan.course_scope.mode === "explicit" && !plan.course_scope.queries.length) throw new Error("Missing course query");
  if (new Set(plan.operations.map((op) => op.type)).size !== plan.operations.length) throw new Error("Duplicate operation");
  // Planning precedes discovery: there are no known opaque resource IDs yet.
  if (plan.operations.some((op) => op.resource_ids.length)) throw new Error("Unknown resource ID");
  return structuredClone(plan);
}
