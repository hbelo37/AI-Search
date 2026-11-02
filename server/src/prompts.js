// Prompt builders. All prompts live on the server so the public API cannot be used as an open LLM proxy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = process.env.DATA_PATH || path.resolve(here, "../../data/ais-data.json");
export const D = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const S = D.schema;
const IND = new Map(S.industry);
const KIDS = {};
for (const [n, p] of S.industry) if (p) (KIDS[p] ||= []).push(n);
const DEPT = S.functions;

export const USER_CTX = "Saved personas: 'RevOps Leaders' (used 7 times). Lead lists: 'Webinar Attendees'. Account lists: 'Q3 Target Accounts'.";
export const ORGS = ["Org A", "Org B"];
export function orgContext(name) {
  if (name === "Org A") return `ICP: ${D.fixtures["Org A – ICP"]}\nExisting customers: ${D.fixtures["Org A – existing customers"]}`;
  return "None (no ICP description, no customers, no product offerings).";
}

function filterLines(tab) {
  return S.filters.filter(f => f.tabs.includes(tab)).map(f => {
    let vals;
    if (S.enum[f.fid]) vals = S.enum[f.fid].join("; ");
    else if (f.fid === "industry") vals = "see INDUSTRY";
    else if (f.fid === "department") vals = "see DEPARTMENT";
    else if (f.fid.startsWith("location")) vals = f.fid.endsWith("postal") ? "postal code strings; radius 'Within 25 miles' | 'Within 100 miles' | 'Within 200 miles' | 'Within 300 miles' (operator Radius)" : "see LOCATION";
    else if (f.fid === "company" || f.fid === "parent_company") vals = "see COMPANY";
    else if (f.fid.startsWith("tech_")) vals = "see TECHNOGRAPHICS";
    else if (f.fid.startsWith("intent")) vals = "NOT ENABLED FOR THIS ORG";
    else if (f.fid === "contact_keywords") vals = "free-text keywords; scope one of: " + S.kw_scope.join(" | ");
    else if (f.fid === "company_keywords") vals = "free-text keywords";
    else if (f.fid === "persona" || f.fid.startsWith("lists_")) vals = "user's saved items only (see USER)";
    else vals = f.vtype;
    return `${f.fid} | ${f.name}${f.mode ? " [" + f.mode.split(" (")[0] + "]" : ""} | ${f.entity} | ${f.selection} | ${f.operators} | ${vals}`;
  }).join("\n");
}
const industryText = () => Object.entries(KIDS).filter(([p]) => !IND.get(p))
  .map(([p, kids]) => `${p}: ${kids.map(k => KIDS[k] ? `${k} (${KIDS[k].join(", ")})` : k).join("; ")}`).join("\n");

// Static part: identical for every call → sent as a cached system block (cheaper, faster).
export const INTERPRET_SYSTEM = `You are the AI Search interpreter of a B2B prospecting app. Convert the user's natural-language query into the app's EXISTING search filters and reply with ONLY one JSON object.

INDUSTRY values (Parent: children; selecting a parent covers its children):
${industryText()}

DEPARTMENT values: "Function (All)" or "Function › Sub-function". Functions and sub-functions:
${Object.entries(DEPT).map(([f, s]) => `${f}: ${s.join("; ")}`).join("\n")}

LOCATION value format: "<Country> (Country)", "<Region> (Region)", "<State>, <Country> (State)", "<City>, <State>, <Country> (City)", "<Area>, <Country> (Metropolitan Area)". Regions: Global, APAC, EMEA, LATAM, North America, Asia, Oceania, Africa, Europe, Middle East, Caribbean Region, Central America, South America, Russia. Known examples: ${S.locations.filter(l => !l.endsWith("(Region)")).join("; ")}.
COMPANY / PARENT COMPANY (exact-match only; known indexed records): ${Object.entries(S.companies).map(([n, g]) => `${n} [${g}]`).join("; ")}. Any other company name → status Unresolved (not found in index).
TECHNOGRAPHICS known values: products ${Object.entries(S.tech.tech_product).map(([n, c]) => `${n} [${c}]`).join("; ")}; vendors ${Object.entries(S.tech.tech_vendor).map(([n, c]) => `${n} [${c}]`).join("; ")}; categories ${Object.entries(S.tech.tech_category).map(([n, c]) => `${n} [${c}]`).join("; ")}.

HOW TO INTERPRET
- Split the query into conditions (one per requirement). Never drop a requirement: if it cannot be applied, keep it with status "Unresolved" (no valid value / not found / conflict / validation fails) or "Unsupported" (no filter can represent it).
- Never invent a filter, value, operator or context. Use only listed values (or the location format).
- Resolution order: structured filter → LLM knowledge mapped to existing values → org context → keyword fallback (contact_keywords / company_keywords) → Unresolved.
- Only use operator "Exclude" when that filter lists Exclude. Single-select filters take ONE value or ONE range.
- Range filters use min/max numbers: years fields in years; total_funding_amount in dollars; revenue_custom in $M; headcount_custom in employees; founded_year min = Since, max = Till; dept_headcount: department name in values + min/max; data_grade: list the grades covered in values with operator Range.
- Decision rules:
${D.rules.map(r => `  ${r.id} ${r.name}: ${r.rule}`).join("\n")}

OUTPUT (JSON only):
{"intent":"one short sentence","primary_entity":"Lead|Account|Unknown","ambiguous":false,"ambiguity_note":"",
 "conditions":[{"text":"words from the query","status":"Applied|Unresolved|Unsupported","filter_id":"seniority or null","operator":"Include|Exclude|Range|Radius","values":["VP"],"min":null,"max":null,"scope":"contact_keywords only: Current Job Title|Current Job Description|All Jobs or Bios","resolution_path":"Structured filter|LLM knowledge|Org/ICP context|Keyword fallback|—","normalization":"raw → canonical, or empty","reason":"why, when not Applied"}]}`;

export function interpretUser({ query, tab, date, org }) {
  return `TODAY (use for every relative date): ${date}
SEARCH TAB: ${tab} (Leads = people search; Accounts = company search. Only filters listed below exist on this tab.)
ORG CONTEXT: ${orgContext(org)}
USER: ${USER_CTX}
ENTITLEMENTS: Intent filters are not enabled for this org.

FILTERS on this tab (id | name | entity | selection | operators | values):
${filterLines(tab)}

QUERY: ${JSON.stringify(query)}`;
}

export function promptSuggestionsPrompt({ org, variation }) {
  const hasCtx = org === "Org A";
  return `Generate 3 distinct, actionable search prompts a sales user could type into a B2B prospecting search (finding leads or accounts).
${hasCtx ? "Base them on this org context and do not invent facts beyond it:\n" + orgContext("Org A") : "No org context is available: use broadly useful GTM prompts (fallback)."}
Each prompt must be answerable with these filters: seniority, department, person or HQ location, industry, global revenue, global headcount, funding round/date, technographics, job changed, promoted. No two prompts may cover the same search with minor wording changes. Max 16 words each.
Reply with only a JSON array of 3 strings.${variation ? " Variation #" + variation + "." : ""}`;
}

export function refinePrompt({ query, org }) {
  return `A sales user searched a B2B prospecting tool with: ${JSON.stringify(query)}.
Suggest 3 refined or related search prompts that keep a clear relationship to it and add value (narrow by role, size, location, funding, technology or timing). Do not repeat the original. ${org === "Org A" ? "Org context (use only if relevant, never invent): " + orgContext("Org A") : ""}
Reply with only a JSON array of 3 strings, max 18 words each.`;
}

const SUG = ["revenue_predef", "headcount_predef", "seniority", "department", "persona"];
const F = Object.fromEntries(S.filters.map(f => [f.fid, f]));
export function filterSuggestionPrompt({ trigger, applied, eligible, org, rejected }) {
  const icp = org === "Org A" ? D.fixtures["Org A – ICP"] : "";
  const elig = (eligible || []).filter(f => SUG.includes(f));
  return {
    eligible: elig,
    prompt: `You suggest ONE next search filter for a B2B prospecting user.
Triggering filter (manually applied/changed): ${F[trigger]?.name || trigger}
Currently applied: ${(applied || []).join(" AND ") || "nothing"}
Eligible filters (choose at most one): ${elig.map(f => `${f} (${F[f].name})`).join(", ")}
Context rules: Revenue, Employee Count (headcount_predef), Seniority and Department may only use the ICP Description. Persona may only use the most-used persona (used more than 5 times).
ICP Description: ${icp || "NOT AVAILABLE"}
Most-used persona: RevOps Leaders (used 7 times)
Allowed values: revenue_predef: ${S.enum.revenue_predef.join("; ")} | headcount_predef: ${S.enum.headcount_predef.join("; ")} | seniority: ${S.enum.seniority.join("; ")} | department: "Function (All)" or "Function › Sub-function" from: ${Object.entries(DEPT).map(([f, s]) => f + ": " + s.join(", ")).join(" | ")} | persona: RevOps Leaders
Never invent ICP facts; never suggest a value the context does not support; pick the filter most useful for refining the current search.
Previously rejected (do not repeat): ${(rejected || []).join(", ") || "none"}
Reply with only JSON: {"filter_id":"...","values":["..."],"reason":"..."} or {"none":true,"reason":"..."}`,
  };
}
