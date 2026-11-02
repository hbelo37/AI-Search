// Canned responses for MOCK_LLM=1 (UI testing and QC walkthroughs without spending API credits).
export function mockInterpret({ query, tab }) {
  const lead = tab === "Leads";
  const conds = [];
  if (lead) conds.push({ text: "VP", status: "Applied", filter_id: "seniority", operator: "Include", values: ["VP"], resolution_path: "Structured filter" });
  if (lead) conds.push({ text: "Sales", status: "Applied", filter_id: "department", operator: "Include", values: ["Sales (All)"] });
  conds.push({ text: "software companies", status: "Applied", filter_id: "industry", operator: "Include", values: ["Software Development"], normalization: "software → Software Development" });
  conds.push({ text: "in North America", status: "Applied", filter_id: "location_hq", operator: "Include", values: ["North America (Region)"] });
  conds.push({ text: "201-1000 employees", status: "Applied", filter_id: "headcount_predef", operator: "Include", values: ["201 to 500", "501 to 1000"] });
  if (/ceo|nps|glassdoor/i.test(query)) conds.push({ text: "unsupported attribute", status: "Unsupported", filter_id: null, reason: "No matching filter" });
  return { intent: "[MOCK] " + query.slice(0, 80), primary_entity: lead ? "Lead" : "Account", ambiguous: false, conditions: conds };
}
export function mockList(kind) {
  if (kind === "refine") return ["[MOCK] Narrow to Directors and VPs only", "[MOCK] Add companies that raised funding in the last 12 months", "[MOCK] Limit to companies using Salesforce"];
  if (kind === "Org A") return ["[MOCK] VPs of Sales at North American software companies with 201-1000 employees", "[MOCK] RevOps directors at cybersecurity companies in the US", "[MOCK] Software companies in North America funded in the last 12 months"];
  return ["[MOCK] Find VP of Sales in EMEA", "[MOCK] Companies in North America with 1,001+ employees", "[MOCK] Marketing directors at banks in the UK"];
}
export function mockFilterSuggestion(eligible) {
  if (eligible.includes("headcount_predef")) return { filter_id: "headcount_predef", values: ["201 to 500", "501 to 1000"], reason: "[MOCK] ICP targets 201–1,000 employees" };
  if (eligible.includes("revenue_predef")) return { filter_id: "revenue_predef", values: ["$50M - $100M", "$100M - $250M"], reason: "[MOCK] ICP revenue band" };
  if (eligible.includes("seniority")) return { filter_id: "seniority", values: ["VP", "Director"], reason: "[MOCK] ICP buyers are VP / Director" };
  return { none: true, reason: "[MOCK] nothing to suggest" };
}
