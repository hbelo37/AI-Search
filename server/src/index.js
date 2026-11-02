// AI Search prototype API. Deploy on Railway (or run locally): `npm start` from the repo root.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { completeJSON, MODELS } from "./llm.js";
import { D, ORGS, INTERPRET_SYSTEM, interpretUser, promptSuggestionsPrompt, refinePrompt, filterSuggestionPrompt } from "./prompts.js";
import { mockInterpret, mockList, mockFilterSuggestion } from "./mock.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

// ---- CORS (only needed when the frontend calls Railway directly instead of through the Netlify proxy)
const ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-app-passcode");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---- shared passcode (keeps the public URL from becoming a free LLM endpoint)
const PASSCODE = process.env.APP_PASSCODE || "";
function requirePasscode(req, res, next) {
  if (!PASSCODE || req.headers["x-app-passcode"] === PASSCODE) return next();
  res.status(401).json({ error: "passcode_required", message: "Enter the team passcode to use AI Search." });
}

// ---- simple per-IP rate limit
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 60);
const hits = new Map();
function rateLimit(req, res, next) {
  const k = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "?";
  const now = Date.now(); const arr = (hits.get(k) || []).filter(t => now - t < 60000); arr.push(now); hits.set(k, arr);
  if (arr.length > LIMIT) return res.status(429).json({ error: "rate_limited", message: "Too many requests – wait a minute." });
  next();
}

const tierOf = t => (["quick", "default", "complex"].includes(t) ? t : "default");
const tabOf = t => (t === "Accounts" ? "Accounts" : "Leads");
const orgOf = o => (ORGS.includes(o) ? o : "Org B");
const dateOf = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : D.schema.eval_date);
const str = (v, n = 1000) => String(v ?? "").slice(0, n);

function fail(res, e) {
  const status = e?.status === 429 ? 429 : e?.code === "invalid_json" ? 502 : e?.status === 401 ? 500 : 502;
  const code = e?.status === 429 ? "rate_limited" : e?.code === "invalid_json" ? "invalid_json" : e?.status === 401 ? "server_misconfigured" : "upstream_error";
  console.error("[ai-search]", code, e?.message);
  res.status(status).json({ error: code, message: e?.message || "AI call failed", raw: e?.raw });
}

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/config", (req, res) => res.json({ models: MODELS, evalDate: D.schema.eval_date, passcodeRequired: !!PASSCODE, mock: process.env.MOCK_LLM === "1" }));
app.post("/api/check-passcode", requirePasscode, (req, res) => res.json({ ok: true }));

app.post("/api/interpret", requirePasscode, rateLimit, async (req, res) => {
  const b = req.body || {};
  const query = str(b.query, 600).trim();
  if (!query) return res.status(400).json({ error: "invalid_request", message: "query is required" });
  const args = { query, tab: tabOf(b.tab), date: dateOf(b.evalDate), org: orgOf(b.org) };
  try {
    const r = await completeJSON({ system: INTERPRET_SYSTEM, user: interpretUser(args), tier: tierOf(b.tier), maxTokens: 4000, mock: () => mockInterpret(args) });
    res.json({ raw: r.json, model: r.model, ms: r.ms, usage: r.usage });
  } catch (e) { fail(res, e); }
});

app.post("/api/prompt-suggestions", requirePasscode, rateLimit, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await completeJSON({ user: promptSuggestionsPrompt({ org: orgOf(b.org), variation: Number(b.variation) || 0 }), tier: "quick", maxTokens: 600, mock: () => mockList(orgOf(b.org)) });
    res.json({ items: Array.isArray(r.json) ? r.json.slice(0, 3).map(String) : [], model: r.model });
  } catch (e) { fail(res, e); }
});

app.post("/api/refine", requirePasscode, rateLimit, async (req, res) => {
  const b = req.body || {};
  const query = str(b.query, 600).trim();
  if (!query) return res.status(400).json({ error: "invalid_request", message: "query is required" });
  try {
    const r = await completeJSON({ user: refinePrompt({ query, org: orgOf(b.org) }), tier: "quick", maxTokens: 600, mock: () => mockList("refine") });
    res.json({ items: Array.isArray(r.json) ? r.json.slice(0, 3).map(String) : [], model: r.model });
  } catch (e) { fail(res, e); }
});

app.post("/api/filter-suggestion", requirePasscode, rateLimit, async (req, res) => {
  const b = req.body || {};
  const { prompt, eligible } = filterSuggestionPrompt({
    trigger: str(b.trigger, 60), applied: (b.applied || []).slice(0, 30).map(x => str(x, 300)),
    eligible: (b.eligible || []).map(x => str(x, 40)), org: orgOf(b.org), rejected: (b.rejected || []).slice(0, 30).map(x => str(x, 200)),
  });
  if (!eligible.length) return res.json({ raw: { none: true, reason: "No eligible filter" } });
  try {
    const r = await completeJSON({ user: prompt, tier: "quick", maxTokens: 400, mock: () => mockFilterSuggestion(eligible) });
    res.json({ raw: r.json, model: r.model });
  } catch (e) { fail(res, e); }
});

// Optional: serve the frontend from the same service (single-service Railway deploy).
if (process.env.SERVE_WEB !== "0") app.use(express.static(path.resolve(here, "../../web"), { extensions: ["html"] }));

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`[ai-search] listening on :${port} · models ${JSON.stringify(MODELS)}${process.env.MOCK_LLM === "1" ? " · MOCK MODE" : ""}`));
