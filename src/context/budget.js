// Budget complete records before serialization. Never slice serialized JSON.
export function budgetContext(records, maxChars = 18000) {
  if (!Number.isInteger(maxChars) || maxChars < 2) throw new Error("Context budget must be at least 2");
  const output = { version: 2, records: [], omitted: records.length };
  if (JSON.stringify(output).length > maxChars) return "{}";
  for (const record of [...records].sort((a, b) => b.priority - a.priority)) {
    const { priority: _, ...data } = record;
    output.records.push(data); output.omitted--;
    if (JSON.stringify(output).length > maxChars) { output.records.pop(); output.omitted++; }
  }
  return JSON.stringify(output);
}
