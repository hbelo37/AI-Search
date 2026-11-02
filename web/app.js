// AI Search prototype frontend (ported from the artifact prototype). Talks to the API in server/.
(() => {
"use strict";
const D = window.AIS_DATA;
const S = D.schema;
const F = Object.fromEntries(S.filters.map(f => [f.fid, f]));
const IND = new Map(S.industry); // name -> parent
const IND_KIDS = {}; for (const [n, p] of S.industry) if (p) (IND_KIDS[p] ||= []).push(n);
const DEPT = S.functions;
const DEPT_VALUES = Object.keys(DEPT).flatMap(fn => [fn + " (All)", ...DEPT[fn].map(s => fn + " › " + s)]);
const COMPANY_CANON = Object.fromEntries(Object.entries(S.companies).map(([n, g]) => [n.toLowerCase(), `${n} [${g}]`]));
const TECH_CANON = {}; for (const [fid, m] of Object.entries(S.tech)) TECH_CANON[fid] = Object.fromEntries(Object.entries(m).map(([n, c]) => [n.toLowerCase(), `${n} [${c}]`]));
const SUG_FILTERS = ["revenue_predef", "headcount_predef", "seniority", "department", "persona"];
const LOG_FIELDS = ["User Query","Intent","Primary Entity","Conditions","Filters","Values","Normalization","Selection Type","Include/Exclude","Unsupported","Ambiguous","Keyword Fallback","Partial Resolution","Final Structured Query","Output Validity","Latency","Token Usage"];
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

// ------------------------------------------------------------------ state
const st = {
  page: "dashboard", tab: "Leads", prompt: "", status: "empty", applied: [], notApplied: [], interp: null,
  sug: null, rejected: new Set(), fbFor: null, fbState: "idle",
  spot: false, drawer: false, dtab: "log", listening: null,
  promptSug: { empty: null, gen: 0, history: [], refine: null },
  recent: store.get("aisp.recent", []),
  suglog: [],
  settings: Object.assign({ evalDate: S.eval_date, org: "Org A", tier: "default" }, store.get("aisp.settings", {})),
  bench: { running: false, done: [], cat: "all", pol: "all", n: 20, ctl: null },
};
// ---- server API (prompts are built on the server; the API key never reaches the browser)
const API = (window.AIS_API_BASE || "").replace(/\/$/, "");
let aiState = "pending", cfg = null, gate = false;
const pass = { get: () => store.get("ais.passcode", ""), set: v => store.set("ais.passcode", v) };
async function api(path, body, signal) {
  let res;
  try { res = await fetch(API + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-app-passcode": pass.get() }, body: body ? JSON.stringify(body) : undefined, signal }); }
  catch (e) { throw { code: e?.name === "AbortError" ? "cancelled" : "network" }; }
  let j = null; try { j = await res.json(); } catch {}
  if (!res.ok) { const err = { code: j?.error || "http_" + res.status, message: j?.message, raw: j?.raw }; if (err.code === "passcode_required") { gate = true; render(); } throw err; }
  return j;
}
(async () => {
  try { cfg = await api("/api/config"); aiState = "ready"; if (cfg.passcodeRequired && !pass.get()) gate = true; } catch { aiState = "absent"; }
  render(); if (aiState === "ready" && !gate) loadEmptySuggestions();
})();

// ------------------------------------------------------------------ helpers
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ico = {
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  mic: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  spark: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z"/></svg>',
  bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5-6.7V3a2 2 0 1 0-4 0v1.3A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12 5 5 9-10"/></svg>',
  thumbdown: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7l-1.4 9A2 2 0 0 0 4.3 15zM17 2h3v11h-3"/></svg>',
  chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>',
  regen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/></svg>',
  send: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg>',
  enter: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 5v7a3 3 0 0 1-3 3H5M9 11l-4 4 4 4"/></svg>',
  log: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
};
function snack(msg) { const el = document.createElement("div"); el.className = "snack"; el.textContent = msg; document.body.append(el); setTimeout(() => el.remove(), 3600); }
function errCopy(e) {
  const c = e?.code;
  if (c === "not_granted" || c === "sampling_disabled") return "AI Search needs permission to use Claude in this view.";
  if (c === "passcode_required") return "Enter the team passcode to use AI Search.";
  if (c === "network") return "Can't reach the AI Search server. Check your connection.";
  if (c === "server_misconfigured") return "The server's Anthropic API key is missing or invalid. Ask the admin to check Railway settings.";
  if (c === "rate_limited") return "Too many AI requests right now. Wait a moment and try again.";
  if (c === "invalid_json") return "The AI reply couldn't be read. Try again.";
  if (c === "cancelled") return "Stopped.";
  return "AI Search couldn't finish. Try again.";
}
function orgContext(name) {
  const fx = D.fixtures;
  if (name === "Org A") return `ICP: ${fx["Org A – ICP"]}\nExisting customers: ${fx["Org A – existing customers"]}`;
  return "None (no ICP description, no customers, no product offerings).";
}
const USER_CTX = "Saved personas: 'RevOps Leaders' (used 7 times). Lead lists: 'Webinar Attendees'. Account lists: 'Q3 Target Accounts'.";
function nameOf(v) { return String(v).replace(/ \[[^\]]+\]$/, "").replace(/ \((Country|State|City|Region|Metropolitan Area)\)$/, ""); }

// ------------------------------------------------------------------ validator (schema enforcement after the model)
function canonValue(fid, v) {
  const s = String(v).trim();
  if (S.enum[fid]) { const hit = S.enum[fid].find(x => x.toLowerCase() === s.toLowerCase()); return hit ? { v: hit } : { err: `'${s}' is not a ${F[fid].name} value` }; }
  if (fid === "industry") { const hit = [...IND.keys()].find(x => x.toLowerCase() === s.toLowerCase()); return hit ? { v: hit } : { err: `'${s}' is not an Industry value` }; }
  if (fid === "department") { const hit = DEPT_VALUES.find(x => x.toLowerCase() === s.toLowerCase()) || (DEPT[s] ? s + " (All)" : null); return hit ? { v: hit } : { err: `'${s}' is not a Department value` }; }
  if (fid === "company" || fid === "parent_company") { const key = nameOf(s).toLowerCase(); return COMPANY_CANON[key] ? { v: COMPANY_CANON[key] } : { err: `'${nameOf(s)}' is not in the company index snapshot`, unres: true }; }
  if (fid.startsWith("tech_")) { const key = nameOf(s).toLowerCase(); return TECH_CANON[fid][key] ? { v: TECH_CANON[fid][key] } : { v: s, note: `'${s}' not in the prototype's technology snapshot (kept, unverified)` }; }
  if (fid === "location_lead" || fid === "location_hq") {
    if (S.locations.includes(s)) return { v: s };
    if (/\((Country|State|City|Region|Metropolitan Area)\)$/.test(s)) return { v: s, note: `'${s}' not in the verified location snapshot (kept, unverified)` };
    return { err: `'${s}' is not in the location format` };
  }
  return { v: s };
}
function validate(raw, tab, query, ms) {
  const notes = [], applied = [], notApplied = [];
  const conds = Array.isArray(raw?.conditions) ? raw.conditions : [];
  const seen = {};
  for (const c of conds) {
    const base = { text: c.text || "", fid: c.filter_id || null, op: c.operator || "Include", vals: Array.isArray(c.values) ? c.values : [], mn: c.min ?? null, mx: c.max ?? null,
      scope: c.scope || "", path: c.resolution_path || "Structured filter", norm: c.normalization || "", reason: c.reason || "" };
    if (c.status && c.status !== "Applied") { notApplied.push({ ...base, status: c.status }); continue; }
    const f = F[base.fid];
    const reject = (why, status = "Unresolved") => { notes.push({ warn: true, t: `Validator blocked "${base.text}": ${why}` }); notApplied.push({ ...base, status, reason: why }); };
    if (!f) { reject(`unknown filter '${base.fid}'`); continue; }
    if (!f.tabs.includes(tab)) { reject(`${f.name} is not available on the ${tab} tab`); continue; }
    if (base.fid.startsWith("intent")) { reject("Intent is not enabled for this org", "Unsupported"); continue; }
    if (base.op === "Exclude" && !f.operators.includes("Exclude")) { reject(`${f.name} does not support Exclude`); continue; }
    if (base.fid === "contact_keywords" && !S.kw_scope.includes(base.scope)) base.scope = "Current Job Title";
    const vals = [];
    let bad = null;
    for (const v of base.vals) {
      if (base.op === "Radius") { vals.push(v); continue; }
      const r = canonValue(base.fid === "dept_headcount" ? "dept_headcount" : base.fid, v);
      if (r.err) { bad = r; break; }
      if (r.note) notes.push({ t: r.note });
      vals.push(r.v);
    }
    if (bad) { reject(bad.err); continue; }
    base.vals = vals;
    // numbers
    const year = Number(ms.date.slice(0, 4));
    for (const k of ["mn", "mx"]) if (base[k] != null) base[k] = Number(base[k]);
    if ((base.mn != null && (isNaN(base.mn) || base.mn < 0)) || (base.mx != null && (isNaN(base.mx) || base.mx < 0))) { reject("negative or invalid number"); continue; }
    if (base.mn != null && base.mx != null && base.mn > base.mx) { reject("Min is greater than Max"); continue; }
    if (base.fid === "founded_year" && ((base.mn && base.mn > year) || (base.mx && base.mx > year))) { reject(`year is after ${year}`); continue; }
    if (f.selection.startsWith("Single") && base.fid !== "data_grade" && base.op !== "Radius") {
      const key = base.fid + (base.op === "Radius" ? "r" : "");
      if (base.vals.length > 1) { notes.push({ warn: true, t: `${f.name} is single-select: kept '${base.vals[0]}', dropped the rest (R13)` }); notApplied.push({ ...base, vals: base.vals.slice(1), status: "Unresolved", reason: "single-select: first value wins" }); base.vals = base.vals.slice(0, 1); }
      if (seen[key]) { notes.push({ warn: true, t: `${f.name} already has a value: "${base.text}" left unresolved (R13)` }); notApplied.push({ ...base, status: "Unresolved", reason: "single-select conflict: first stated wins" }); continue; }
    }
    if (!base.vals.length && base.mn == null && base.mx == null) { reject("no value"); continue; }
    seen[base.fid + (base.op === "Radius" ? "r" : "")] = true;
    applied.push(base);
  }
  return { applied, notApplied, notes, intent: raw?.intent || "", entity: raw?.primary_entity || (tab === "Leads" ? "Lead" : "Account"), ambiguous: !!raw?.ambiguous, ambNote: raw?.ambiguity_note || "", query, ms: ms.ms, tokens: ms.tokens };
}
function condLabel(c) {
  const f = F[c.fid]; const mode = (c.fid === "contact_keywords") ? c.scope : (f.mode && !["department", "industry", "dept_headcount", "founded_year"].includes(c.fid) ? f.mode.split(" (")[0] : "");
  return f.name + (mode ? ` [${mode}]` : "");
}
function condStr(c) {
  const parts = [...c.vals];
  if (c.fid === "founded_year") { if (c.mn != null) parts.push("Since " + c.mn); if (c.mx != null) parts.push("Till " + c.mx); }
  else { if (c.mn != null) parts.push("Min " + c.mn.toLocaleString()); if (c.mx != null) parts.push("Max " + c.mx.toLocaleString()); }
  const op = (c.op === "Range" || c.mn != null || c.mx != null) ? "=" : (c.op === "Exclude" ? "Exclude:" : c.op === "Radius" ? "Radius:" : "Include:");
  return `${condLabel(c)} ${op} ${parts.join(op === "=" ? "; " : ", ")}`;
}
function buildLog(r) {
  const ap = r.applied, na = r.notApplied;
  const sel = [...new Set(ap.map(c => `${condLabel(c)} = ${F[c.fid].selection.startsWith("Multi") ? "Multi-select" : (F[c.fid].selection.includes("range") ? "Single (range)" : "Single-select")}`))];
  return {
    "User Query": r.query, "Intent": r.intent || "(unclear)", "Primary Entity": r.entity,
    "Conditions": [...ap, ...na].map(c => c.text).filter(Boolean).join("; ") || "(none identified)",
    "Filters": [...ap.map(condLabel), ...na.filter(c => F[c.fid]).map(c => condLabel(c) + " (not applied)")].join("; "),
    "Values": ap.map(c => `${condLabel(c)}: ${condStr(c).split(/ (?:Include:|Exclude:|Radius:|=) /)[1]}`).join(" | "),
    "Normalization": [...ap, ...na].map(c => c.norm).filter(Boolean).join("; "),
    "Selection Type": sel.join("; "),
    "Include/Exclude": ap.map(c => `${condLabel(c)}: ${c.op === "Exclude" ? "Exclude" : "Include"}`).join("; "),
    "Unsupported": na.map(c => `${c.text} (${c.status}${c.reason ? ": " + c.reason : ""})`).join("; "),
    "Ambiguous": r.ambiguous ? "Yes" : "",
    "Keyword Fallback": [...ap, ...na].filter(c => c.path === "Keyword fallback").map(c => `${c.text} → ${c.fid === "contact_keywords" ? "Contact Keywords → " + c.scope : "Company Keywords"}`).join("; "),
    "Partial Resolution": ap.length && na.length ? "Yes" : "No",
    "Final Structured Query": ap.map(condStr).join(" AND "),
    "Output Validity": r.parseOk ? "Valid" : "Invalid",
    "Latency": (r.ms / 1000).toFixed(1) + " s" + (r.serverMs != null ? ` (model ${(r.serverMs / 1000).toFixed(1)} s)` : ""),
    "Token Usage": r.tokens ? `${(r.tokens.input_tokens || 0) + (r.tokens.cache_read_input_tokens || 0) + (r.tokens.cache_creation_input_tokens || 0)} in (${r.tokens.cache_read_input_tokens || 0} cached) / ${r.tokens.output_tokens || 0} out · ${r.model}` : "—",
  };
}

// ------------------------------------------------------------------ AI calls
async function interpret(query, tab, ctx, signal) {
  if (aiState !== "ready") throw { code: "network" };
  const t0 = performance.now();
  const j = await api("/api/interpret", { query, tab, evalDate: ctx.date, org: ctx.org, tier: ctx.tier }, signal);
  const ms = performance.now() - t0;
  const r = validate(j.raw, tab, query, { date: ctx.date, ms, tokens: j.usage });
  r.parseOk = j.raw && typeof j.raw === "object"; r.raw = j.raw; r.model = j.model; r.serverMs = j.ms; r.log = buildLog(r);
  return r;
}
let runCtl = null;
async function runSearch(q, opts = {}) {
  q = (q || "").trim(); if (!q) return;
  st.page = "discover"; st.prompt = q; st.status = "loading"; st.sug = null; st.promptSug.refine = null; st.notApplied = [];
  st.applied = []; // new AI search replaces previous filters (IG-17001)
  render();
  runCtl?.abort(); runCtl = new AbortController();
  try {
    const r = await interpret(q, st.tab, { date: st.settings.evalDate, org: st.settings.org, tier: st.settings.tier }, runCtl.signal);
    st.interp = r; st.applied = r.applied.map(c => ({ ...c, source: "ai" })); st.notApplied = r.notApplied;
    st.status = r.applied.length ? "results" : "noresults";
    st.recent = [{ q, tab: st.tab, n: r.applied.length }, ...st.recent.filter(x => x.q !== q)].slice(0, 8); store.set("aisp.recent", st.recent);
  } catch (e) {
    if (e?.code === "cancelled") return;
    st.status = st.applied.length ? "results" : "empty"; snack(errCopy(e));
  }
  render();
}
async function loadEmptySuggestions(regen = false) {
  if (aiState !== "ready") return;
  const pst = st.promptSug;
  if (regen) {
    if (pst.gen >= 5) { pst.empty = pst.history[pst.gen % pst.history.length]; pst.gen++; render(); return; } // max 5 generations, then cycle (IG-17231)
  }
  pst.loading = true; render();
  try {
    const arr = (await api("/api/prompt-suggestions", { org: st.settings.org, variation: regen ? pst.gen + 1 : 0 })).items;
    if (Array.isArray(arr)) { pst.empty = arr.slice(0, 3).map(String); pst.history.push(pst.empty); if (regen) pst.gen++; }
  } catch (e) { if (e?.code !== "cancelled") snack(errCopy(e)); }
  pst.loading = false; render();
}
async function loadRefine(q) {
  if (aiState !== "ready" || !q) return;
  st.promptSug.refine = "loading"; render();
  try { const arr = (await api("/api/refine", { query: q, org: st.settings.org })).items; st.promptSug.refine = Array.isArray(arr) ? arr.slice(0, 3).map(String) : null; }
  catch (e) { st.promptSug.refine = null; if (e?.code !== "cancelled") snack(errCopy(e)); }
  render();
}

// ------------------------------------------------------------------ filter suggestion engine (IG-17103 / IG-17232)
async function suggestNext(trigger) {
  st.sug = null;
  if (aiState !== "ready" || !SUG_FILTERS.includes(trigger)) { render(); return; }
  const tab = st.tab;
  const eligible = SUG_FILTERS.filter(fid => F[fid].tabs.includes(tab) && !st.applied.some(c => c.fid === fid || (fid === "revenue_predef" && c.fid === "revenue_custom") || (fid === "headcount_predef" && c.fid === "headcount_custom")));
  const icp = st.settings.org === "Org A" ? D.fixtures["Org A – ICP"] : "";
  const logBase = { time: new Date().toLocaleTimeString(), trigger: F[trigger].name, applied: st.applied.map(condStr).join(" AND "), context: icp ? "ICP Description available" : "No ICP Description", eligible: eligible.map(f => F[f].name).join(", ") };
  if (!eligible.length) { st.suglog.unshift({ ...logBase, outcome: "No eligible filter" }); render(); return; }
  try {
    const r = (await api("/api/filter-suggestion", { trigger, applied: st.applied.map(condStr), eligible, org: st.settings.org, rejected: [...st.rejected] })).raw;
    if (r?.none || !r?.filter_id || !eligible.includes(r.filter_id)) { st.suglog.unshift({ ...logBase, outcome: "No suggestion", reason: r?.reason || "" }); render(); return; }
    const vals = []; for (const v of r.values || []) { const c = r.filter_id === "persona" ? (v === "RevOps Leaders" ? { v } : { err: 1 }) : canonValue(r.filter_id, v); if (!c.err) vals.push(c.v); }
    const key = r.filter_id + ":" + vals.join("|");
    if (!vals.length || st.rejected.has(key)) { st.suglog.unshift({ ...logBase, outcome: "Suggestion dropped (invalid or previously rejected)", reason: r.reason }); render(); return; }
    st.sug = { fid: r.filter_id, vals, reason: r.reason, key, logIdx: 0 };
    st.suglog.unshift({ ...logBase, suggested: `${F[r.filter_id].name}: ${vals.join(", ")}`, reason: r.reason, outcome: "Shown" });
  } catch (e) { if (e?.code !== "cancelled") st.suglog.unshift({ ...logBase, outcome: "Error: " + (e?.code || "unknown") }); }
  render();
}
function acceptSug() {
  const s = st.sug; if (!s) return;
  st.applied.push({ fid: s.fid, op: "Include", vals: s.vals, mn: null, mx: null, text: "suggestion", path: "Suggestion", norm: "", source: "suggestion" });
  st.suglog[0] && (st.suglog[0].outcome = "Accepted");
  st.sug = null; st.status = "results"; render(); suggestNext(s.fid);
}
function rejectSug() {
  const s = st.sug; if (!s) return;
  st.rejected.add(s.key); st.suglog[0] && (st.suglog[0].outcome = "Rejected");
  st.fbFor = { fid: s.fid, label: F[s.fid].name, value: s.vals.join(", "), idx: 0 }; st.fbState = "idle"; st.sug = null; render();
}

// ------------------------------------------------------------------ rendering
function render() {
  const app = $("#app");
  const focusId = document.activeElement?.id; const selStart = document.activeElement?.selectionStart;
  app.innerHTML = navHTML() + (st.page === "dashboard" ? dashHTML() : st.page === "discover" ? discHTML() : benchHTML()) + (st.spot ? spotHTML() : "") + (st.drawer ? drawerHTML() : "") + (gate ? gateHTML() : "");
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch {} } }
}
function navHTML() {
  const L = (p, t, cls = "") => `<button class="${cls}" data-go="${p}" ${st.page === p ? 'aria-current="page"' : ""}>${t}</button>`;
  return `<nav class="nav"><div class="brand"><span class="mark">${ico.spark}</span>SMARTe <small>AI Search prototype</small></div>
  <div class="navlinks">${L("dashboard", "Dashboard")}${L("discover", "Discover")}<button disabled style="opacity:.5">Enrich</button><button disabled style="opacity:.5">Lists</button>${L("benchmark", "Benchmark", "bench")}</div>
  <div class="navright">${logBtnHTML()}<button class="iconbtn" data-act="spot" aria-label="Quick Search">${ico.search}<span class="tip">Quick Search <span class="kbd">Ctrl</span> <span class="kbd">K</span></span></button>
  <span class="iconbtn" aria-hidden="true">${ico.bell}</span><span class="credits"><i></i>1000</span><span class="avatar" aria-hidden="true"></span></div></nav>`;
}
function fieldHTML(id, value, ph, opts = {}) {
  if (st.listening === id) return listenHTML(id);
  return `<div class="aifield ${opts.disabled ? "disabled" : ""}">${opts.noicon ? "" : `<span class="muted">${ico.search}</span>`}
    <input id="${id}" value="${esc(value)}" placeholder="${esc(ph)}" autocomplete="off" ${opts.disabled ? "disabled" : ""} aria-label="AI Search">
    <button class="mic" data-act="mic" data-for="${id}" aria-label="Voice input">${ico.mic}</button>
    <button class="go" data-act="go" data-for="${id}" aria-label="Search" ${value.trim() && !opts.disabled ? "" : "disabled"}>${ico.arrow}</button></div>`;
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function startRec(target, onText) {
  stopRec(); if (!SR) return;
  try {
    rec = new SR(); rec.lang = navigator.language || "en-US"; rec.interimResults = true; rec.continuous = true;
    rec.onresult = ev => { let t = ""; for (const r of ev.results) t += r[0].transcript; onText(t); };
    rec.onerror = ev => { if (ev.error === "not-allowed") snack("Microphone permission was denied. Type instead."); };
    rec.start();
  } catch { rec = null; }
}
function stopRec() { try { rec?.stop(); } catch {} rec = null; }
function listenHTML(id) {
  return `<div class="listen"><span class="orb" aria-hidden="true"></span><div style="flex:1;min-width:0"><div class="lbl">LISTENING</div>
  <textarea id="vt-${id}" rows="1" placeholder="Start speaking. Your words will appear here"></textarea>
  <div class="note">${SR ? "Speak now — words appear above. You can also edit them." : "Voice input isn't supported in this browser (use Chrome or Edge) — type here instead."}</div></div>
  <div class="acts"><button class="sq" data-act="vcancel" aria-label="Cancel">${ico.x}</button><button class="sq ok" data-act="vok" data-for="${id}" aria-label="Confirm">${ico.check}</button></div></div>`;
}
function unavailableHTML() {
  if (aiState === "ready") return cfg?.mock ? `<div class="unavail">Mock mode: the server returns canned answers (MOCK_LLM=1). Set an API key and remove MOCK_LLM on the server for real results.</div>` : "";
  if (aiState === "pending") return `<div class="unavail">Connecting to the AI Search server…</div>`;
  return `<div class="unavail">Can't reach the AI Search server. Check that the API is running and that the site's /api proxy points to it.</div>`;
}
function gateHTML() {
  return `<div class="scrim"><form class="card gate" id="gateform" role="dialog" aria-modal="true" aria-label="Team passcode"><h2>Team passcode</h2><p class="muted">This prototype runs on a paid AI model. Enter the passcode your team shared with you.</p>
  <input id="gatein" type="password" autocomplete="current-password" aria-label="Passcode" placeholder="Passcode"><div class="gateerr" id="gateerr"></div><button class="btn primary" type="submit">Continue</button></form></div>`;
}
// dashboard
let dashFocus = false;
function dashHTML() {
  const sug = st.promptSug.empty;
  const q = st.dashQ || "";
  return `<main class="page"><div class="dash">
  <h1 class="hero-title">Prospect smarter with <span class="ai-grad">SMARTe AI</span> <span class="spark">${ico.spark}</span></h1>
  ${unavailableHTML()}
  <div class="glow"><div class="popwrap">${fieldHTML("dq", q, "e.g Find me CEO's of tech companies in San Francisco", { noicon: true })}
    ${dashFocus && st.listening !== "dq" ? dashPopHTML(q) : ""}</div>
    <div class="sugrow">${sug ? sug.slice(0, 2).map(s => `<button class="sugchip" data-run="${esc(s)}"><span class="sparkdot">${ico.spark}</span><span>${esc(s)}</span></button>`).join("") : `<span class="muted" style="font-size:13px;padding:6px">${st.promptSug.loading ? "Generating suggestions…" : aiState === "ready" ? "" : "Suggestions appear here"}</span>`}
    <button class="regen" data-act="regen" aria-label="Regenerate suggestions" ${st.promptSug.loading || aiState !== "ready" ? "disabled" : ""} title="Regenerate (${Math.min(st.promptSug.gen, 5)}/5)">${ico.regen}</button></div></div>
  <section><h2 class="sec-title">Recent AI Searches</h2>${st.recent.length ? `<div class="recent">${st.recent.map(r => `<button class="card" data-recent="${esc(r.q)}" data-tab="${r.tab}"><span class="q">${esc(r.q)}</span><span class="meta"><b>${r.n}</b> filters · ${r.tab}</span></button>`).join("")}</div>` : `<div class="card empty-recent">Your AI searches will appear here. Try a suggestion above.</div>`}</section>
  </div></main>`;
}
function dashPopHTML(q) {
  if (!q.trim()) return `<div class="pop"><div class="poplabel">Recent searches</div>${st.recent.slice(0, 5).map(r => `<button class="popitem" data-recent="${esc(r.q)}" data-tab="${r.tab}"><span class="muted">${ico.search}</span>${esc(r.q)}</button>`).join("") || `<div class="popnote">Search for leads or accounts, or describe who you're looking for.</div>`}</div>`;
  return `<div class="pop"><button class="airow" data-run="${esc(q)}"><span class="ic">${ico.spark}</span><span class="lab">AI Search</span><span class="qq">“${esc(q)}”</span><span class="ent">${ico.enter}</span></button>
  <div class="poplabel">Leads</div><div class="popnote">Name matches for leads appear here in the product (keyword search is not part of this prototype).</div>
  <div class="poplabel">Accounts</div><div class="popnote">Name matches for accounts appear here in the product.</div></div>`;
}
// discover
const FILTER_ORDER = {
  Leads: ["seniority","department","location","contact_keywords","years_experience","years_role","years_company","job_changed","promoted","persona","lists_lead","lists_account","data_grade","exclusions","intent","signals","last_funding_date","total_funding_amount","last_funding_round","total_funding_rounds","is_subsidiary","multinational","company_keywords","tech","industry","revenue","headcount","dept_headcount","founded_year","parent_company","company"],
  Accounts: ["hqloc","lists_account","exclusions","intent","signals","last_funding_date","total_funding_amount","last_funding_round","total_funding_rounds","is_subsidiary","multinational","company_keywords","tech","industry","revenue","headcount","dept_headcount","founded_year","parent_company","company"],
};
const GROUPS = { location: ["location_lead","location_lead_postal","location_hq","location_hq_postal"], hqloc: ["location_hq","location_hq_postal"], revenue: ["revenue_predef","revenue_custom"], headcount: ["headcount_predef","headcount_custom"], tech: ["tech_product","tech_vendor","tech_category"], signals: ["signals_date","signals_type"], intent: ["intent_topics","intent_level","intent_threshold","intent_location","intent_lookback"] };
const GNAME = { location: "Location", hqloc: "Global HQ Location", revenue: "Global Revenue", headcount: "Global Headcount", tech: "Technographics", signals: "Account Signals", intent: "Intent" };
function chipText(c) {
  const f = c.fid;
  if (c.mn != null || c.mx != null) {
    const a = c.mn, b = c.mx, fmt = n => n.toLocaleString();
    if (f.startsWith("years_")) return a != null && b != null ? `${a}-${b} Years` : a != null ? `Min ${a} Years` : `Max ${b} Years`;
    if (f === "founded_year") return a != null && b != null ? `${a} - ${b}` : a != null ? `Since ${a}` : `Till ${b}`;
    if (f === "total_funding_amount") return a != null && b != null ? `$${fmt(a)} - $${fmt(b)}` : a != null ? `Min $${fmt(a)}` : `Max $${fmt(b)}`;
    if (f === "revenue_custom") return a != null && b != null ? `$${a}M - $${b}M` : a != null ? `Min $${a}M` : `Max $${b}M`;
    const pre = f === "dept_headcount" ? (c.vals[0] + ": ") : "";
    return pre + (a != null && b != null ? `${fmt(a)} to ${fmt(b)}` : a != null ? `Min ${fmt(a)}` : `Max ${fmt(b)}`);
  }
  return null;
}
function chipsFor(fids) {
  let h = "";
  st.applied.forEach((c, i) => {
    if (!fids.includes(c.fid)) return;
    const rt = chipText(c);
    if (rt) { h += `<span class="chip rng" title="${esc(condStr(c))}"><span>${esc(rt)}</span><button data-rm="${i}" aria-label="Remove">×</button></span>`; return; }
    if (c.fid === "data_grade") { h += `<span class="chip rng"><span>${esc(c.vals[0])} to ${esc(c.vals[c.vals.length - 1])}</span><button data-rm="${i}" aria-label="Remove">×</button></span>`; return; }
    c.vals.forEach((v, j) => {
      let t = nameOf(v); if (c.fid === "department") t = v.endsWith(" (All)") ? v.replace(" (All)", " · All") : v.split(" › ")[1];
      if (c.op === "Radius") t = v;
      h += `<span class="chip ${c.op === "Exclude" ? "exc" : "inc"}" title="${esc(v)}"><span>${esc(t)}</span>${c.fid === "contact_keywords" ? `<span class="scope">${esc(c.scope)}</span>` : ""}<button data-rm="${i}" data-rmv="${j}" aria-label="Remove">×</button></span>`;
    });
  });
  if (st.sug && fids.includes(st.sug.fid)) h += st.sug.vals.map(v => `<span class="chip sug" tabindex="0" title="Suggested: ${esc(st.sug.reason || "")}"><span class="plus">+</span><span>${esc(st.sug.fid === "department" ? (v.endsWith(" (All)") ? v.replace(" (All)", " · All") : v.split(" › ")[1]) : nameOf(v))}</span><span class="acts"><button class="a" data-act="sugok" aria-label="Accept suggestion">${ico.check}</button><button class="r" data-act="sugno" aria-label="Reject suggestion">${ico.thumbdown}</button></span></span>`).join("");
  return h;
}
function addSelect(fid) {
  const list = S.enum[fid] && !F[fid].selection.startsWith("Single") ? S.enum[fid] : fid === "department" ? DEPT_VALUES : null;
  if (!list) return "";
  return `<select class="addsel" data-add="${fid}" aria-label="Add ${esc(F[fid].name)} value"><option value="">+ Add ${esc(F[fid].name)}</option>${list.map(v => `<option>${esc(v)}</option>`).join("")}</select>`;
}
function accHTML(key) {
  const fids = GROUPS[key] ? GROUPS[key].filter(f => F[f] && F[f].tabs.includes(st.tab)) : [key];
  if (!fids.length || !F[fids[0]]) return "";
  const name = GNAME[key] || F[fids[0]].name;
  const n = st.applied.filter(c => fids.includes(c.fid)).reduce((a, c) => a + Math.max(1, c.vals.length), 0);
  const hasSug = st.sug && fids.includes(st.sug.fid);
  const disabled = key === "intent";
  const open = (n > 0 || hasSug) && !disabled;
  return `<div class="acc ${disabled ? "disabled" : ""}" ${open ? "open" : ""}><button class="acc-h" data-acc="${key}" ${disabled ? 'disabled title="Not enabled for this org"' : ""}>${esc(name)}${disabled ? ' <span class="tag">Not enabled</span>' : ""}${n ? ` <span class="cnt red">${n} ×</span>` : ""}<span class="chev">${ico.chev}</span></button>
  ${open || st.openAcc === key ? `<div class="acc-b">${chipsFor(fids)}${fids.map(addSelect).join("")}</div>` : ""}</div>`;
}
function discHTML() {
  const tabs = ["Leads", "Accounts"].map(t => `<button class="t" role="tab" aria-selected="${st.tab === t}" data-tab-switch="${t}">${t}</button>`).join("");
  const total = st.applied.reduce((a, c) => a + Math.max(1, c.vals.length), 0);
  return `<div class="subnav" role="tablist">${tabs}<div class="r"><span>Saved Search</span><span>Persona</span></div></div>
  <main class="page" style="height:100%"><div class="disc">
    <aside class="card panel"><div class="panel-head"><div class="crit">New Criteria ${total ? `<span class="cnt">${total} <button data-act="clear" aria-label="Clear all">×</button></span>` : ""}<span style="margin-left:auto" class="muted">Load Search</span></div>
      <input class="fsearch" placeholder="Search filters" aria-label="Search filters" id="fsearch" value="${esc(st.fq || "")}"></div>
      <div class="panel-body">${FILTER_ORDER[st.tab].filter(k => !st.fq || (GNAME[k] || F[k]?.name || "").toLowerCase().includes(st.fq.toLowerCase())).map(accHTML).join("")}</div>
      <div class="panel-foot">${st.fbFor ? fbHTML() : ""}<button class="btn" disabled>Save Search</button></div></aside>
    <section class="main">${unavailableHTML()}${st.status === "empty" ? emptyStateHTML() : resultsHTML()}</section>
  </div></main>`;
}
function emptyStateHTML() {
  const sug = st.promptSug.empty;
  return `<div class="card empty"><div class="hint">Or apply filters manually to start searching ←</div><div class="inner">
  <h2>Prospect smarter with <span class="ai-grad">SMARTe AI</span> <span class="spark">${ico.spark}</span></h2><p>Type or speak what you're looking for and AI will pick the right filters for you</p>
  ${fieldHTML("eq", st.eqDraft || "", "Describe the leads or accounts you want…")}
  <div class="ailabel"><span class="spark">${ico.spark}</span>AI Search Suggestions</div>
  <div class="sugcards">${sug ? sug.map(s => `<button data-run="${esc(s)}">${esc(s)}</button>`).join("") : `<span class="muted" style="font-size:12px">${st.promptSug.loading ? "Generating…" : "—"}</span>`}</div></div></div>`;
}
function resultsHTML() {
  const loading = st.status === "loading";
  const ent = st.tab === "Leads" ? "Leads" : "Accounts";
  const top = `<div class="searchtop">${fieldHTML("rq", st.rqDraft ?? st.prompt, "Describe the leads or accounts you want…", { disabled: loading })}${st.dropOpen && !loading ? dropHTML() : ""}</div>`;
  const na = st.notApplied.length && !loading ? `<div class="notapplied"><b>Not applied:</b> ${st.notApplied.map(c => `${esc(c.text)} <span class="muted">(${esc(c.reason || c.status)})</span>`).join(" · ")}</div>` : "";
  let body;
  if (loading) body = `<div class="loadhead"><span class="ic">${ico.spark}</span><div><b style="font-weight:500">Finding ${ent}</b><small>Analyzing your query</small></div><span class="loadbar"></span></div><div class="rows">${Array.from({ length: 8 }, () => `<div class="rowi"><span class="skel" style="width:16px;height:16px"></span><span class="skel" style="width:40px;height:40px"></span><span><span class="skel" style="display:block;width:70%;height:10px"></span><span class="skel" style="display:block;width:40%;height:10px;margin-top:8px"></span></span><span class="skel" style="width:18px;height:18px"></span><span class="skel" style="height:10px"></span><span class="skel c3" style="height:10px"></span><span></span></div>`).join("")}</div>`;
  else if (st.status === "noresults") body = `<div class="toolbar">${toolbarBtns(true)}</div><div class="empty"><div class="inner"><span class="muted" style="justify-self:center">${ico.search.replace(/16/g, "48")}</span><b style="font-weight:500">No results found</b><p>Try describing the leads or accounts you're looking for using role, industry, location, revenue, or company size.</p></div></div>`;
  else body = `<div class="toolbar">${toolbarBtns(false)}</div><div class="samplebar">Sample rows — this prototype builds the structured query; it doesn't search real lead or account data. Open the interpretation log (top right) to see all 17 log fields.</div><div class="rows">${sampleRows()}</div><div class="pager"><span>Results per page <span class="tag">10</span></span><span class="pages"><span>Previous</span><span class="on">1</span><span>2</span><span>3</span><span>Next</span></span></div>`;
  return `${top}${na}<div class="card results">${body}</div>`;
}
function toolbarBtns(dis) {
  return `<button class="btn" ${dis ? "disabled" : ""}><span class="cbox"></span>All</button><button class="btn" ${dis ? "disabled" : ""}>Save to list ${ico.chev}</button><button class="btn" ${dis ? "disabled" : ""}>${st.tab === "Leads" ? "Reveal" : "Track"}</button>
  <span class="count">${dis ? "" : `<b>Sample</b> ${st.tab}`}</span><button class="btn" ${dis ? "disabled" : ""}>View Stats</button><button class="btn primary" ${dis ? "disabled" : ""}>Export ${ico.chev}</button>`;
}
function dropHTML() {
  const r = st.promptSug.refine;
  return `<div class="drop"><div class="poplabel">AI Suggestions</div>${r === "loading" ? `<div class="popnote">Generating suggestions…</div>` : (r || st.promptSug.empty || []).map(s => `<button class="popitem" data-run="${esc(s)}"><span class="sparkdot spark">${ico.spark}</span>${esc(s)}</button>`).join("")}</div>`;
}
const SAMPLE_CO = [["Northwind Systems","#2563eb"],["Contoso Ltd","#059669"],["Fabrikam Inc","#7c3aed"],["Tailspin Labs","#db2777"],["Wide World Importers","#ea580c"],["Litware","#0891b2"],["Adventure Works","#65a30d"],["Proseware","#475569"]];
const SAMPLE_PEOPLE = ["Ana Ruiz","Ben Okafor","Chen Wei","Dana Kim","Eli Novak","Farah Haddad","Gus Lindqvist","Hana Sato"];
function pickVals(fids, dflt) { const c = st.applied.find(x => fids.includes(x.fid) && x.vals.length); return c ? c.vals.map(nameOf) : dflt; }
function sampleRows() {
  const inds = pickVals(["industry"], ["Software Development", "Banking", "Manufacturing", "Retail Trade"]);
  const hcs = pickVals(["headcount_predef"], ["201 to 500", "1001 to 5000", "51 to 200"]);
  const revs = pickVals(["revenue_predef"], ["$10M - $25M", "$100M - $250M", "$1B - $5B"]);
  const sens = pickVals(["seniority"], ["VP", "Director", "Manager"]);
  const locs = pickVals(["location_lead", "location_hq"], ["United States", "United Kingdom", "India"]);
  return SAMPLE_CO.map(([n, col], i) => {
    const lead = st.tab === "Leads";
    return `<div class="rowi"><span class="cbox"></span><span class="logo" style="background:${col}">${n.split(" ").map(w => w[0]).join("").slice(0, 2)}</span>
    <span style="min-width:0"><div class="n">${lead ? SAMPLE_PEOPLE[i] : n}</div><div class="s">${lead ? `${esc(sens[i % sens.length])} · ${n}` : "Entity type"}</div></span><span class="li">in</span>
    <span style="min-width:0"><div class="s" style="color:var(--g700)">${esc(inds[i % inds.length])}</div><div class="s">${esc(locs[i % locs.length])}</div></span>
    <span class="c3" style="min-width:0"><div class="s" style="color:var(--g700)">${esc(hcs[i % hcs.length])}</div><div class="s">${esc(revs[i % revs.length])}</div></span><span class="chev2 muted">›</span></div>`;
  }).join("");
}
function fbHTML() {
  const f = st.fbFor;
  if (st.fbState === "sent") return `<div class="fb"><div class="h"><span class="ico">${ico.check}</span><div><small>Feedback submitted</small>Thanks — this helps tune suggestions.</div><button class="x" data-act="fbclose" aria-label="Close">${ico.x}</button></div></div>`;
  const listening = st.fbState === "rec";
  return `<div class="fb"><div class="h"><span class="ico">${ico.thumbdown}</span><div>${listening ? `<small style="color:var(--fire)">● Listening</small>` : `<small>${esc(f.label)}</small>`}${esc(f.value)}</div><button class="x" data-act="fbclose" aria-label="Close">${ico.x}</button></div>
  ${listening ? `<div class="row"><div class="wave" style="flex:1">${Array.from({ length: 34 }, (_, i) => `<i style="height:${6 + (i * 37 % 20)}px;animation-delay:${(i % 7) * .1}s"></i>`).join("")}</div><button class="send" data-act="fbstop" aria-label="Stop">■</button></div><div class="note muted" style="font-size:11px">${SR ? "Listening — press stop when done; the text lands in the box." : "Voice input isn't supported in this browser — stop and type instead."}</div>`
  : `<div class="row"><input id="fbtext" placeholder="Type here..." value="${esc(st.fbText || "")}" aria-label="Why wasn't this useful?"><button class="mic iconbtn" data-act="fbmic" aria-label="Voice feedback">${ico.mic}</button><button class="send" data-act="fbsend" aria-label="Submit feedback" ${st.fbState === "sending" ? "disabled" : ""}>${ico.send}</button></div>`}</div>`;
}
// spotlight
let spotIdx = 0;
function spotRows() {
  const q = (st.spotQ || "").trim(); const rows = [];
  if (q) rows.push({ k: "ai", q });
  (st.promptSug.empty || []).forEach(s => rows.push({ k: "sug", q: s }));
  return rows;
}
function spotHTML() {
  const rows = spotRows(); const q = (st.spotQ || "").trim();
  spotIdx = Math.min(spotIdx, Math.max(0, rows.length - 1));
  return `<div class="scrim" data-act="spotclose"><div class="spot" role="dialog" aria-modal="true" aria-label="Quick Search" data-stop="1">
  <div class="top">${st.listening === "sq" ? `<div style="flex:1">${listenHTML("sq")}</div>` : `<span class="muted">${ico.search}</span><input id="sq" value="${esc(st.spotQ || "")}" placeholder="Search or ask anything" autocomplete="off" aria-label="Search or ask anything"><button class="mic" data-act="mic" data-for="sq" aria-label="Voice input">${ico.mic}</button>`}</div>
  <div class="body">${rows.map((r, i) => r.k === "ai" ? `<button class="airow ${i === spotIdx ? "hl" : ""}" data-run="${esc(r.q)}" style="${i === spotIdx ? "" : "border-color:transparent;background:none"}"><span class="ic">${ico.spark}</span><span class="lab">AI Search</span><span class="qq">“${esc(r.q)}”</span><span class="ent">${ico.enter}</span></button>`
    : (i === (q ? 1 : 0) ? `<div class="poplabel">AI Suggestions</div>` : "") + `<button class="popitem ${i === spotIdx ? "hl" : ""}" data-run="${esc(r.q)}"><span class="sparkdot">${ico.spark}</span>${esc(r.q)}</button>`).join("")}
  ${!rows.length ? `<div class="popnote">${st.promptSug.loading ? "Generating suggestions…" : "Type to run an AI Search."}</div>` : ""}
  ${q ? `<div class="poplabel">Leads</div><div class="popnote">Name matches appear here in the product.</div><div class="poplabel">Accounts</div><div class="popnote">Name matches appear here in the product.</div>` : ""}</div>
  <div class="foot"><span><span class="kbd">↑</span> <span class="kbd">↓</span> Navigate</span><span><span class="kbd">↵</span> Search</span><span class="r"><span class="kbd">esc</span> Close</span></div></div></div>`;
}
// log drawer
function logBtnHTML() { return st.page === "benchmark" ? "" : `<button class="logbtn" data-act="drawer" aria-label="Interpretation log">${ico.log}<span>Interpretation log</span></button>`; }
function drawerHTML() {
  const t = (k, n) => `<button role="tab" aria-selected="${st.dtab === k}" data-dtab="${k}">${n}</button>`;
  let body = "";
  const r = st.interp;
  if (st.dtab === "log") body = r ? `<table class="logt">${LOG_FIELDS.map(f => `<tr><th>${f}</th><td>${esc(r.log[f]) || '<span class="muted">—</span>'}</td></tr>`).join("")}</table>` : `<p class="muted">Run an AI Search to see the 17 IG-17053 log fields.</p>`;
  if (st.dtab === "val") body = r ? (r.notes.length ? r.notes.map(n => `<div class="vnote ${n.warn ? "warn" : ""}">${esc(n.t)}</div>`).join("") : `<p class="muted">The validator accepted every condition.</p>`) : `<p class="muted">Nothing yet.</p>`;
  if (st.dtab === "raw") body = r ? `<pre class="raw">${esc(JSON.stringify(r.raw, null, 2))}</pre>` : `<p class="muted">Nothing yet.</p>`;
  if (st.dtab === "sug") body = st.suglog.length ? st.suglog.map(l => `<table class="logt" style="margin-bottom:12px">${Object.entries({ Time: l.time, "Trigger source": "Manual filter change: " + l.trigger, "Selected filters": l.applied, "Company/ICP context": l.context, "Eligible filters": l.eligible, "Suggested filter / values": l.suggested, Reason: l.reason, Outcome: l.outcome, "Reject reason": l.fb }).map(([k, v]) => `<tr><th>${k}</th><td>${esc(v) || '<span class="muted">—</span>'}</td></tr>`).join("")}</table>`).join("") : `<p class="muted">Remove a filter value or add one with “+ Add” (Revenue, Headcount, Seniority, Department, Persona) to trigger a filter suggestion.</p>`;
  if (st.dtab === "set") body = `<div class="settings">
    <label>Evaluation date (relative dates use this)<input type="date" id="set-date" value="${st.settings.evalDate}"></label>
    <label>Org context<select id="set-org"><option ${st.settings.org === "Org A" ? "selected" : ""} value="Org A">Org A — ICP + customers</option><option ${st.settings.org === "Org B" ? "selected" : ""} value="Org B">Org B — no context</option></select></label>
    <label>Model tier<select id="set-tier">${["quick", "default", "complex"].map(t => `<option ${st.settings.tier === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <p class="muted" style="margin:0">Pinned models: ${cfg ? Object.entries(cfg.models).map(([k, v]) => esc(k + " = " + v)).join(" · ") : "—"}</p>
    <button class="btn" data-act="logout" type="button">Forget passcode</button>
    <p class="muted" style="margin:0">The interpreter sees only the filter schema, value lists, decision rules R01–R20 and this context — never the gold-set answers.</p></div>`;
  return `<div class="drawer" role="dialog" aria-label="Interpretation log"><header><h3>Prototype panel</h3><button class="iconbtn" style="margin-left:auto" data-act="drawer" aria-label="Close">${ico.x}</button></header>
  <div class="dtabs" role="tablist">${t("log", "Log (17 fields)")}${t("val", "Validator")}${t("raw", "Raw JSON")}${t("sug", "Suggestion log")}${t("set", "Settings")}</div><div class="dbody">${body}</div></div>`;
}

// ------------------------------------------------------------------ benchmark
function expandT(fid, v) {
  if (fid === "department") { const m = /^(.*) \(All\)$/.exec(v); if (m && DEPT[m[1]]) return DEPT[m[1]].map(s => `${m[1]} › ${s}`); return [v]; }
  if (fid === "industry") { const leaves = n => IND_KIDS[n] ? IND_KIDS[n].flatMap(leaves) : [n]; return IND.has(v) ? leaves(v) : [v]; }
  return [v];
}
function tuples(list) {
  const out = new Set();
  for (const [fid, op0, vals, mn, mx] of list) {
    const op = (op0 === "Range" || op0 === "Radius" || !op0) ? "Include" : op0;
    for (const v of vals || []) for (const leaf of expandT(fid, v)) out.add(`${fid}|${op}|${String(leaf).toLowerCase().replace(/\s+/g, " ").trim()}`);
    if (mn != null) out.add(`${fid}|min|${Number(mn)}`); if (mx != null) out.add(`${fid}|max|${Number(mx)}`);
  }
  return out;
}
function scoreCase(g, r) {
  const gold = tuples(g.ap), pred = tuples(r.applied.map(c => [c.fid, c.op, c.vals, c.mn, c.mx]));
  const inter = [...gold].filter(x => pred.has(x)).length;
  const exact = gold.size === pred.size && inter === gold.size;
  const gf = new Set(g.ap.map(a => a[0])), pf = new Set(r.applied.map(c => c.fid));
  const fi = [...gf].filter(x => pf.has(x)).length;
  const fP = pf.size ? fi / pf.size : (gf.size ? 0 : 1), fR = gf.size ? fi / gf.size : (pf.size ? 0 : 1);
  return { exact, alt: !exact && g.ap.some(a => a[5]), fF1: fP + fR ? 2 * fP * fR / (fP + fR) : 0, vR: gold.size ? inter / gold.size : (pred.size ? 0 : 1),
    flagged: g.na ? Math.min(r.notApplied.length, g.na) / g.na : null, silent: g.na ? (r.notApplied.length === 0 ? 1 : 0) : null,
    amb: (!!r.ambiguous) === !!g.amb, vs: (r.applied.length === 0 ? "No executable query" : r.notApplied.length ? "Valid – partial" : "Valid") === g.vs,
    blocked: r.notes.filter(n => n.warn).length };
}
function benchCases() {
  const b = st.bench;
  return D.gold.filter(g => (b.cat === "all" || g.cat.startsWith(b.cat + " ")) && (b.pol === "all" || g.pol === b.pol));
}
async function runBench() {
  const b = st.bench; if (b.running || aiState !== "ready") return;
  const pool = benchCases(); const n = Math.max(1, Math.min(Number(b.n) || 20, pool.length));
  const pick = pool.slice(0, n);
  b.running = true; b.done = []; b.total = pick.length; b.ctl = new AbortController(); render();
  let i = 0;
  const worker = async () => {
    while (i < pick.length && !b.ctl.signal.aborted) {
      const g = pick[i++];
      try {
        const r = await interpret(g.p, g.t, { date: S.eval_date, org: g.fx === "Org A" ? "Org A" : "Org B", tier: st.settings.tier }, b.ctl.signal);
        b.done.push({ g, r, s: scoreCase(g, r) });
      } catch (e) { if (e?.code === "cancelled") break; b.done.push({ g, err: e?.code || "error" }); if (["rate_limited", "passcode_required", "network", "server_misconfigured"].includes(e?.code)) { b.ctl.abort(); snack(errCopy(e)); } }
      render();
    }
  };
  await Promise.all([worker(), worker()]);
  b.running = false; render();
}
function benchCSV() {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["id", "category", "polarity", "tab", "prompt", "result", "exact", "filter_f1", "value_recall", "unresolved_flagged", "ambiguity_match", "validation_match", "expected_fsq", "prototype_fsq", "expected_not_applied", "prototype_not_applied", "model", "latency_s", "error"];
  const rows = st.bench.done.map(d => [d.g.id, d.g.cat, d.g.pol, d.g.t, d.g.p, d.err ? "Error" : d.s.exact ? "Match" : d.s.alt ? "Check alternative" : "Mismatch", d.s?.exact ? 1 : 0, d.s?.fF1?.toFixed(3), d.s?.vR?.toFixed(3), d.s?.flagged?.toFixed?.(3) ?? "", d.s ? +d.s.amb : "", d.s ? +d.s.vs : "", d.g.fsq, d.r?.log["Final Structured Query"], d.g.na || 0, d.r?.notApplied.length ?? "", d.r?.model, d.r ? (d.r.ms / 1000).toFixed(1) : "", d.err || ""]);
  const blob = new Blob([[head, ...rows].map(r => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ai-search-benchmark-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function pct(x) { return x == null || isNaN(x) ? "—" : Math.round(x * 100) + "%"; }
function avg(a) { const v = a.filter(x => x != null); return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null; }
function benchHTML() {
  const b = st.bench; const ok = b.done.filter(d => d.s); const pool = benchCases();
  const k = { exact: avg(ok.map(d => d.s.exact ? 1 : 0)), alt: avg(ok.map(d => d.s.exact || d.s.alt ? 1 : 0)), f1: avg(ok.map(d => d.s.fF1)), vr: avg(ok.map(d => d.s.vR)),
    fl: avg(ok.map(d => d.s.flagged)), sd: avg(ok.map(d => d.s.silent)), amb: avg(ok.map(d => d.s.amb ? 1 : 0)), vs: avg(ok.map(d => d.s.vs ? 1 : 0)) };
  const byCat = {}; for (const d of ok) { const c = d.g.cat; (byCat[c] ||= []).push(d); }
  const byPol = {}; for (const d of ok) (byPol[d.g.pol] ||= []).push(d);
  const kpi = (l, v, sub) => `<div class="card kpi"><small>${l}</small><b>${v}</b><div class="sub">${sub}</div></div>`;
  return `<main class="page"><div class="bench">
  <div><h1>Benchmark against the gold set</h1><p class="lead">Runs gold-set prompts through this prototype's interpreter and scores them with the same rules as the evaluators. The interpreter never sees the expected answers. Use it to see whether a rule or prompt change helps before handing it to developers.</p></div>
  ${unavailableHTML()}
  <div class="card bctl"><label>Category<select id="b-cat"><option value="all">All 17 categories</option>${D.categories.map(c => `<option value="${c.id}" ${b.cat === c.id ? "selected" : ""}>${c.id} ${esc(c.name)}</option>`).join("")}</select></label>
  <label>Polarity<select id="b-pol">${["all", "Positive", "Negative", "Mixed"].map(p => `<option ${b.pol === p ? "selected" : ""} value="${p}">${p === "all" ? "All" : p}</option>`).join("")}</select></label>
  <label>Cases (of ${pool.length})<input id="b-n" type="number" min="1" max="${pool.length}" value="${b.n}" style="width:90px"></label>
  <label>Model tier<select id="b-tier">${["quick", "default", "complex"].map(t => `<option ${st.settings.tier === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
  ${b.running ? `<button class="btn" data-act="bstop">Stop</button>` : `<button class="btn primary" data-act="brun" ${aiState === "ready" ? "" : "disabled"}>Run benchmark</button>`}
  ${b.done.length && !b.running ? `<button class="btn" data-act="bcsv">Download CSV</button>` : ""}<span class="muted" style="font-size:12px;align-self:center">Model: ${esc(cfg?.models?.[st.settings.tier] || st.settings.tier)} · each case is one API call · two run at a time.</span></div>
  ${b.total ? `<div class="prog" aria-label="Progress"><i style="width:${Math.round(b.done.length / b.total * 100)}%"></i></div><div class="muted" style="font-size:12px">${b.done.length} of ${b.total} cases${b.running ? " · running…" : ""}</div>` : ""}
  ${ok.length ? `<div class="kpis">${kpi("Final query exact", pct(k.exact), "primary answer only")}${kpi("Exact or has alternative", pct(k.alt), "alternatives need a judge")}${kpi("Filter F1", pct(k.f1), "")}${kpi("Value recall", pct(k.vr), "")}${kpi("Unresolved flagged", pct(k.fl), "negative handling")}${kpi("Silent drop", pct(k.sd), "lower is better")}${kpi("Ambiguity flag match", pct(k.amb), "")}${kpi("Validation status match", pct(k.vs), "")}</div>
  <div class="card tbl-wrap"><table class="bt"><thead><tr><th>Slice</th><th>Cases</th><th>Final query exact</th><th>Filter F1</th><th>Value recall</th><th>Unresolved flagged</th></tr></thead><tbody>
  ${Object.entries(byPol).map(([p, a]) => `<tr><td><b style="font-weight:500">${p}</b></td><td>${a.length}</td><td>${pct(avg(a.map(d => d.s.exact ? 1 : 0)))}</td><td>${pct(avg(a.map(d => d.s.fF1)))}</td><td>${pct(avg(a.map(d => d.s.vR)))}</td><td>${pct(avg(a.map(d => d.s.flagged)))}</td></tr>`).join("")}
  ${Object.entries(byCat).sort().map(([c, a]) => `<tr><td>${esc(c)}</td><td>${a.length}</td><td>${pct(avg(a.map(d => d.s.exact ? 1 : 0)))}</td><td>${pct(avg(a.map(d => d.s.fF1)))}</td><td>${pct(avg(a.map(d => d.s.vR)))}</td><td>${pct(avg(a.map(d => d.s.flagged)))}</td></tr>`).join("")}
  </tbody></table></div>` : ""}
  ${b.done.length ? `<div class="card tbl-wrap"><table class="bt"><thead><tr><th>Case</th><th>Result</th><th>Prompt</th><th>Expected vs prototype</th></tr></thead><tbody>
  ${b.done.slice().sort((a, c) => (a.s?.exact ? 1 : 0) - (c.s?.exact ? 1 : 0)).map(d => `<tr><td>${d.g.id}<div class="muted" style="font-size:11px">${esc(d.g.pol)}</div></td><td>${d.err ? `<span class="pill bad">${esc(d.err)}</span>` : d.s.exact ? `<span class="pill ok">Match</span>` : d.s.alt ? `<span class="pill alt">Check alternative</span>` : `<span class="pill bad">Mismatch</span>`}</td>
  <td style="min-width:200px">${esc(d.g.p)}</td><td style="min-width:260px"><div class="fsq exp">Expected: ${esc(d.g.fsq || "(no executable query)")}${d.g.na ? ` · ${d.g.na} not applied` : ""}</div>${d.r ? `<div class="fsq">Prototype: ${esc(d.r.log["Final Structured Query"] || "(no executable query)")}${d.r.notApplied.length ? ` · ${d.r.notApplied.length} not applied` : ""}</div>` : ""}</td></tr>`).join("")}
  </tbody></table></div>` : ""}
  </div></main>`;
}

// ------------------------------------------------------------------ events
document.addEventListener("click", e => {
  const t = e.target.closest("[data-go],[data-act],[data-run],[data-recent],[data-tab-switch],[data-acc],[data-rm],[data-dtab]");
  if (!t) { if (!e.target.closest(".popwrap")) { if (dashFocus) { dashFocus = false; render(); } } if (!e.target.closest(".searchtop") && st.dropOpen) { st.dropOpen = false; render(); } return; }
  if (t.dataset.act === "spotclose" && e.target.closest("[data-stop]")) { if (!e.target.closest("[data-act]:not([data-act=spotclose]),[data-run]")) return; }
  if (t.dataset.go) { st.page = t.dataset.go; render(); return; }
  if (t.dataset.run !== undefined) { const q = t.dataset.run; st.spot = false; st.spotQ = ""; dashFocus = false; st.dropOpen = false; st.rqDraft = null; runSearch(q); return; }
  if (t.dataset.recent !== undefined) { st.tab = t.dataset.tab || st.tab; dashFocus = false; runSearch(t.dataset.recent); return; }
  if (t.dataset.tabSwitch) { st.tab = t.dataset.tabSwitch; st.applied = st.applied.filter(c => F[c.fid].tabs.includes(st.tab)); st.sug = null; render(); return; }
  if (t.dataset.acc) { st.openAcc = st.openAcc === t.dataset.acc ? null : t.dataset.acc; render(); return; }
  if (t.dataset.dtab) { st.dtab = t.dataset.dtab; render(); return; }
  if (t.dataset.rm !== undefined) {
    const i = +t.dataset.rm, c = st.applied[i]; if (!c) return;
    if (t.dataset.rmv !== undefined && c.vals.length > 1) c.vals.splice(+t.dataset.rmv, 1); else st.applied.splice(i, 1);
    if (!st.applied.length && st.status === "results") st.status = "noresults";
    render(); suggestNext(c.fid); return;
  }
  const a = t.dataset.act;
  if (a === "spot") { openSpot(); return; }
  if (a === "spotclose") { closeSpot(); return; }
  if (a === "logout") { pass.set(""); gate = !!cfg?.passcodeRequired; render(); return; }
  if (a === "drawer") { st.drawer = !st.drawer; render(); return; }
  if (a === "regen") { loadEmptySuggestions(true); return; }
  if (a === "go") { const id = t.dataset.for; const v = $("#" + id)?.value || ""; st.rqDraft = null; st.eqDraft = ""; st.dashQ = ""; dashFocus = false; runSearch(v); return; }
  if (a === "mic") { st.listening = t.dataset.for; render(); setTimeout(() => $("#vt-" + st.listening)?.focus(), 0); const id = st.listening; startRec(id, txt => { const el = $("#vt-" + id); if (el) el.value = txt; }); return; }
  if (a === "vcancel") { stopRec(); st.listening = null; render(); return; }
  if (a === "vok") { stopRec(); const id = t.dataset.for; const txt = ($("#vt-" + id)?.value || "").trim(); st.listening = null; if (txt) { if (id === "dq") st.dashQ = txt; if (id === "eq") st.eqDraft = txt; if (id === "rq") st.rqDraft = txt; if (id === "sq") st.spotQ = txt; } render(); $("#" + id)?.focus(); return; }
  if (a === "clear") { st.applied = []; st.notApplied = []; st.sug = null; st.status = "empty"; st.prompt = ""; render(); return; }
  if (a === "sugok") { acceptSug(); return; }
  if (a === "sugno") { rejectSug(); return; }
  if (a === "fbclose") { st.fbFor = null; st.fbText = ""; render(); return; }
  if (a === "fbmic") { st.fbState = "rec"; render(); startRec("fb", txt => { st.fbText = txt; }); return; }
  if (a === "fbstop") { stopRec(); st.fbState = "idle"; render(); $("#fbtext")?.focus(); return; }
  if (a === "fbsend") { const v = ($("#fbtext")?.value || "").trim(); st.fbState = "sending"; render(); setTimeout(() => { if (st.suglog[0]) st.suglog[0].fb = v || "(none)"; st.fbState = "sent"; st.fbText = ""; render(); setTimeout(() => { st.fbFor = null; render(); }, 2200); }, 600); return; }
  if (a === "brun") { runBench(); return; }
  if (a === "bcsv") { benchCSV(); return; }
  if (a === "bstop") { st.bench.ctl?.abort(); st.bench.running = false; render(); return; }
});
document.addEventListener("input", e => {
  const id = e.target.id;
  if (id === "dq") { st.dashQ = e.target.value; dashFocus = true; render(); }
  else if (id === "eq") { st.eqDraft = e.target.value; render(); }
  else if (id === "rq") { st.rqDraft = e.target.value; st.dropOpen = false; render(); }
  else if (id === "sq") { st.spotQ = e.target.value; spotIdx = 0; render(); }
  else if (id === "fsearch") { st.fq = e.target.value; render(); }
  else if (id === "fbtext") { st.fbText = e.target.value; }
});
document.addEventListener("focusin", e => {
  if (e.target.id === "dq" && !dashFocus) { dashFocus = true; render(); }
  if (e.target.id === "rq" && !st.dropOpen && st.status !== "loading") { st.dropOpen = true; render(); if (!st.promptSug.refine && st.prompt) loadRefine(st.prompt); }
});
document.addEventListener("change", e => {
  const id = e.target.id;
  if (id === "gatein" || id === "fbtext") return;
  if (e.target.dataset.add) { const fid = e.target.dataset.add, v = e.target.value; if (!v) return;
    const ex = st.applied.find(c => c.fid === fid && c.op === "Include"); if (ex) { if (!ex.vals.includes(v)) ex.vals.push(v); } else st.applied.push({ fid, op: "Include", vals: [v], mn: null, mx: null, text: "manual", source: "manual" });
    if (st.status === "empty" || st.status === "noresults") st.status = "results"; render(); suggestNext(fid); return; }
  if (id === "set-date") st.settings.evalDate = e.target.value || S.eval_date;
  if (id === "set-org") { st.settings.org = e.target.value; st.promptSug = { empty: null, gen: 0, history: [], refine: null }; loadEmptySuggestions(); }
  if (id === "set-tier" || id === "b-tier") st.settings.tier = e.target.value;
  if (id === "b-cat") st.bench.cat = e.target.value;
  if (id === "b-pol") st.bench.pol = e.target.value;
  if (id === "b-n") st.bench.n = e.target.value;
  store.set("aisp.settings", st.settings); render();
});
document.addEventListener("submit", async e => {
  if (e.target.id !== "gateform") return;
  e.preventDefault(); const v = $("#gatein").value.trim(); if (!v) return;
  pass.set(v);
  try { await api("/api/check-passcode", {}); gate = false; render(); if (!st.promptSug.empty) loadEmptySuggestions(); }
  catch (err) { pass.set(""); gate = true; render(); const el = $("#gateerr"); if (el) el.textContent = err.code === "passcode_required" ? "That passcode isn't right." : errCopy(err); $("#gatein")?.focus(); }
});
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (!st.spot) openSpot(); return; }
  if (st.spot) {
    if (e.key === "Escape") { closeSpot(); return; }
    const rows = spotRows();
    if (e.key === "ArrowDown") { e.preventDefault(); spotIdx = Math.min(rows.length - 1, spotIdx + 1); render(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); spotIdx = Math.max(0, spotIdx - 1); render(); return; }
    if (e.key === "Enter" && e.target.id === "sq") { e.preventDefault(); const r = rows[spotIdx]; if (r) { st.spot = false; st.spotQ = ""; runSearch(r.q); } return; }
  }
  if (e.key === "Enter" && ["dq", "eq", "rq"].includes(e.target.id)) { e.preventDefault(); const v = e.target.value; st.dashQ = ""; st.eqDraft = ""; st.rqDraft = null; dashFocus = false; st.dropOpen = false; runSearch(v); }
  if (e.key === "Enter" && e.target.id === "fbtext") { e.preventDefault(); document.querySelector('[data-act="fbsend"]')?.click(); }
  if (e.key === "Escape") { if (st.drawer) { st.drawer = false; render(); } else if (st.listening) { st.listening = null; render(); } else if (dashFocus) { dashFocus = false; render(); } }
});
function openSpot() { st.spot = true; st.spotQ = ""; spotIdx = 0; render(); setTimeout(() => $("#sq")?.focus(), 0); }
function closeSpot() { if (st.listening === "sq") st.listening = null; st.spot = false; st.spotQ = ""; render(); }

render();
})();
