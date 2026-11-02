"""One-off port: proto/template.html (artifact) -> web/{index.html,styles.css,app.js}. Kept for traceability."""
import re, sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text()
out = pathlib.Path(sys.argv[2])
css = src.split("<style>", 1)[1].split("</style>", 1)[0]
js = src.split('<script>\n', 1)[1].rsplit("</script>", 1)[0]

def rep(old, new, count=1, regex=False):
    global js
    if regex:
        js2, n = re.subn(old, new, js, flags=re.S)
    else:
        n = js.count(old); js2 = js.replace(old, new)
    assert n >= count, f"pattern not found ({n}): {old[:70]!r}"
    js = js2

# data
rep('const D = JSON.parse(document.getElementById("data").textContent);', 'const D = window.AIS_DATA;')
# AI layer
rep(r'let sampleFn = null, sampleState = "pending";.*?11000\);\n', r'''// ---- server API (prompts are built on the server; the API key never reaches the browser)
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
''', regex=True)
rep('return "AI Search needs permission to use Claude in this view.";',
    'return "AI Search needs permission to use Claude in this view.";\n  if (c === "passcode_required") return "Enter the team passcode to use AI Search.";\n  if (c === "network") return "Can\'t reach the AI Search server. Check your connection.";\n  if (c === "server_misconfigured") return "The server\'s Anthropic API key is missing or invalid. Ask the admin to check Railway settings.";')
# drop the client-side prompt (it now lives in server/src/prompts.js)
rep(r'// -+ interpreter prompt\n.*?\n// -+ validator', '// ------------------------------------------------------------------ validator', regex=True)
# interpret via server
rep(r'async function interpret\(query, tab, ctx, signal\) \{.*?\n\}\n', '''async function interpret(query, tab, ctx, signal) {
  if (aiState !== "ready") throw { code: "network" };
  const t0 = performance.now();
  const j = await api("/api/interpret", { query, tab, evalDate: ctx.date, org: ctx.org, tier: ctx.tier }, signal);
  const ms = performance.now() - t0;
  const r = validate(j.raw, tab, query, { date: ctx.date, ms, tokens: j.usage });
  r.parseOk = j.raw && typeof j.raw === "object"; r.raw = j.raw; r.model = j.model; r.serverMs = j.ms; r.log = buildLog(r);
  return r;
}
''', regex=True)
rep('"Token Usage": "~" + r.tokens + " (estimated from text length)",',
    '"Token Usage": r.tokens ? `${(r.tokens.input_tokens || 0) + (r.tokens.cache_read_input_tokens || 0) + (r.tokens.cache_creation_input_tokens || 0)} in (${r.tokens.cache_read_input_tokens || 0} cached) / ${r.tokens.output_tokens || 0} out · ${r.model}` : "—",')
rep('"Latency": (r.ms / 1000).toFixed(1) + " s",', '"Latency": (r.ms / 1000).toFixed(1) + " s" + (r.serverMs != null ? ` (model ${(r.serverMs / 1000).toFixed(1)} s)` : ""),')
rep('{ date: st.settings.evalDate, org: orgContext(st.settings.org), tier: st.settings.tier }', '{ date: st.settings.evalDate, org: st.settings.org, tier: st.settings.tier }')
# prompt suggestions
rep(r'  const hasCtx = st.settings.org === "Org A";\n  const p = `Generate 3.*?`;\n  try \{\n    const arr = await sampleFn.json\(p, \{[^\n]*\n',
    '  try {\n    const arr = (await api("/api/prompt-suggestions", { org: st.settings.org, variation: regen ? pst.gen + 1 : 0 })).items;\n', regex=True)
rep(r'  const p = `A sales user searched.*?`;\n  try \{ const arr = await sampleFn.json\(p, \{ modelTier: "quick" \}\);',
    '  try { const arr = (await api("/api/refine", { query: q, org: st.settings.org })).items;', regex=True)
# filter suggestion
rep(r'  const p = `You suggest ONE next.*?`;\n  try \{\n    const r = await sampleFn.json\(p, \{ modelTier: "quick", cache: false \}\);',
    '  try {\n    const r = (await api("/api/filter-suggestion", { trigger, applied: st.applied.map(condStr), eligible, org: st.settings.org, rejected: [...st.rejected] })).raw;', regex=True)
# readiness checks
js = js.replace("!sampleFn", 'aiState !== "ready"').replace('sampleFn ? "" : "disabled"', 'aiState === "ready" ? "" : "disabled"').replace('sampleState === "ready"', 'aiState === "ready"')
rep(r'function unavailableHTML\(\) \{.*?\n\}\n', '''function unavailableHTML() {
  if (aiState === "ready") return cfg?.mock ? `<div class="unavail">Mock mode: the server returns canned answers (MOCK_LLM=1). Set an API key and remove MOCK_LLM on the server for real results.</div>` : "";
  if (aiState === "pending") return `<div class="unavail">Connecting to the AI Search server…</div>`;
  return `<div class="unavail">Can't reach the AI Search server. Check that the API is running and that the site's /api proxy points to it.</div>`;
}
function gateHTML() {
  return `<div class="scrim"><form class="card gate" id="gateform" role="dialog" aria-modal="true" aria-label="Team passcode"><h2>Team passcode</h2><p class="muted">This prototype runs on a paid AI model. Enter the passcode your team shared with you.</p>
  <input id="gatein" type="password" autocomplete="current-password" aria-label="Passcode" placeholder="Passcode"><div class="gateerr" id="gateerr"></div><button class="btn primary" type="submit">Continue</button></form></div>`;
}
''', regex=True)
assert "sampleFn" not in js, "sampleFn left: " + str([m.start() for m in re.finditer("sampleFn", js)])
# benchmark: pass org names
rep(r'      const org = g\.fx === "Org A".*?\n(\s+try \{\n\s+const r = await interpret\(g\.p, g\.t, )\{ date: S\.eval_date, org: [^,]+, tier',
    r'\1{ date: S.eval_date, org: g.fx === "Org A" ? "Org A" : "Org B", tier', regex=True)
rep('if (e?.code === "rate_limited" || e?.code === "not_granted")', 'if (["rate_limited", "passcode_required", "network", "server_misconfigured"].includes(e?.code))')
rep('<span class="muted" style="font-size:12px;align-self:center">Each case is one Claude call on your usage; two run at a time.</span>',
    '${b.done.length && !b.running ? `<button class="btn" data-act="bcsv">Download CSV</button>` : ""}<span class="muted" style="font-size:12px;align-self:center">Model: ${esc(cfg?.models?.[st.settings.tier] || st.settings.tier)} · each case is one API call · two run at a time.</span>')
rep('if (a === "brun") { runBench(); return; }', 'if (a === "brun") { runBench(); return; }\n  if (a === "bcsv") { benchCSV(); return; }')
rep('function pct(x)', '''function benchCSV() {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["id", "category", "polarity", "tab", "prompt", "result", "exact", "filter_f1", "value_recall", "unresolved_flagged", "ambiguity_match", "validation_match", "expected_fsq", "prototype_fsq", "expected_not_applied", "prototype_not_applied", "model", "latency_s", "error"];
  const rows = st.bench.done.map(d => [d.g.id, d.g.cat, d.g.pol, d.g.t, d.g.p, d.err ? "Error" : d.s.exact ? "Match" : d.s.alt ? "Check alternative" : "Mismatch", d.s?.exact ? 1 : 0, d.s?.fF1?.toFixed(3), d.s?.vR?.toFixed(3), d.s?.flagged?.toFixed?.(3) ?? "", d.s ? +d.s.amb : "", d.s ? +d.s.vs : "", d.g.fsq, d.r?.log["Final Structured Query"], d.g.na || 0, d.r?.notApplied.length ?? "", d.r?.model, d.r ? (d.r.ms / 1000).toFixed(1) : "", d.err || ""]);
  const blob = new Blob([[head, ...rows].map(r => r.map(q).join(",")).join("\\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ai-search-benchmark-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function pct(x)''')
# branding (own repo -> product branding is fine)
rep('<span class="mark">${ico.spark}</span>AI Search <small>Prototype</small>', '<span class="mark">${ico.spark}</span>SMARTe <small>AI Search prototype</small>')
rep('Prospect smarter with <span class="ai-grad">AI</span>', 'Prospect smarter with <span class="ai-grad">SMARTe AI</span>', 2)
# settings: show the pinned model
rep('<p class="muted" style="margin:0">The interpreter sees only',
    '<p class="muted" style="margin:0">Pinned models: ${cfg ? Object.entries(cfg.models).map(([k, v]) => esc(k + " = " + v)).join(" · ") : "—"}</p>\n    <button class="btn" data-act="logout" type="button">Forget passcode</button>\n    <p class="muted" style="margin:0">The interpreter sees only')
rep('if (a === "drawer") {', 'if (a === "logout") { pass.set(""); gate = !!cfg?.passcodeRequired; render(); return; }\n  if (a === "drawer") {')
rep('document.addEventListener("change", e => {\n  const id = e.target.id;', 'document.addEventListener("change", e => {\n  const id = e.target.id;\n  if (id === "gatein" || id === "fbtext") return;')
# render the gate
rep('+ (st.drawer ? drawerHTML() : "");', '+ (st.drawer ? drawerHTML() : "") + (gate ? gateHTML() : "");')
rep('document.addEventListener("keydown", e => {', '''document.addEventListener("submit", async e => {
  if (e.target.id !== "gateform") return;
  e.preventDefault(); const v = $("#gatein").value.trim(); if (!v) return;
  pass.set(v);
  try { await api("/api/check-passcode", {}); gate = false; render(); if (!st.promptSug.empty) loadEmptySuggestions(); }
  catch (err) { pass.set(""); gate = true; render(); const el = $("#gateerr"); if (el) el.textContent = err.code === "passcode_required" ? "That passcode isn't right." : errCopy(err); $("#gatein")?.focus(); }
});
document.addEventListener("keydown", e => {''')

# real microphone (Web Speech API) with typing fallback
rep('<div class="note">Microphone isn\'t available in this preview — type here to simulate the transcript.</div>',
    '<div class="note">${SR ? "Speak now — words appear above. You can also edit them." : "Voice input isn\'t supported in this browser (use Chrome or Edge) — type here instead."}</div>')
rep('function listenHTML(id) {', '''const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
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
function listenHTML(id) {''')
rep('if (a === "mic") { st.listening = t.dataset.for; render(); setTimeout(() => $("#vt-" + st.listening)?.focus(), 0); return; }',
    'if (a === "mic") { st.listening = t.dataset.for; render(); setTimeout(() => $("#vt-" + st.listening)?.focus(), 0); const id = st.listening; startRec(id, txt => { const el = $("#vt-" + id); if (el) el.value = txt; }); return; }')
rep('if (a === "vcancel") { st.listening = null;', 'if (a === "vcancel") { stopRec(); st.listening = null;')
rep('if (a === "vok") { const id', 'if (a === "vok") { stopRec(); const id')
rep('if (a === "fbmic") { st.fbState = "rec"; render(); return; }', 'if (a === "fbmic") { st.fbState = "rec"; render(); startRec("fb", txt => { st.fbText = txt; }); return; }')
rep('if (a === "fbstop") { st.fbState = "idle";', 'if (a === "fbstop") { stopRec(); st.fbState = "idle";')
rep('<div class="note muted" style="font-size:11px">Microphone isn\'t available in this preview — stop and type instead.</div>',
    '<div class="note muted" style="font-size:11px">${SR ? "Listening — press stop when done; the text lands in the box." : "Voice input isn\'t supported in this browser — stop and type instead."}</div>')

css += """
/* ---------- narrow screens: nav must never push the page sideways */
.navlinks{min-width:0;flex:1 1 auto}
@media (max-width:560px){.brand small{display:none}.nav{gap:12px}.navright{gap:8px}.navright>span.iconbtn{display:none}}
/* ---------- passcode gate */
.gate{width:min(380px,calc(100% - 32px));margin:12vh auto 0;padding:24px;display:grid;gap:12px;background:var(--surface)}
.gate h2{margin:0;font-size:18px;font-weight:600}.gate p{margin:0;font-size:13px}
.gate input{height:40px;border:1px solid var(--g300);border-radius:8px;padding:0 12px}
.gateerr{color:var(--red-800);font-size:12px;min-height:16px}
"""
(out / "styles.css").write_text(css.strip() + "\n")
(out / "app.js").write_text("// AI Search prototype frontend (ported from the artifact prototype). Talks to the API in server/.\n" + js.strip() + "\n")
(out / "index.html").write_text("""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SMARTe AI Search Prototype</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<div id="app"></div>
<script src="config.js"></script>
<script src="data.js"></script>
<script src="app.js"></script>
</body>
</html>
""")
print("ok", len(js), len(css))
