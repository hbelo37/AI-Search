# SMARTe AI Search — reference prototype and benchmark

A working copy of the AI Search feature: natural-language query to filters, plus suggestions. It follows the Figma flows (Dashboard, Discover, Ctrl+K, feedback) and includes a benchmark page that scores it against the 394-case gold set.

It serves as the **reference implementation** for developers and as a **test bench** for QC:
- change a rule or prompt here;
- re-run the benchmark;
- hand the winning version to the dev team.

```
server/src/      API (Express + Anthropic SDK). All prompts live here – the browser never sees the key or builds prompts.
  prompts.js     interpreter prompt (schema, value lists, decision rules R01–R20) + suggestion prompts  ← tune here
  llm.js         pinned models, temperature 0, prompt caching, tolerant JSON parsing
  mock.js        canned answers for MOCK_LLM=1
web/             static frontend (index.html, styles.css, app.js). Validator, 17-field log and benchmark scoring run here.
data/ais-data.json   filter schema, enums, industry/department trees, rules, fixtures, compact gold set
gold/            full gold set (xlsx, gold_set.json) + LangSmith package
scripts/build-web.mjs   writes web/data.js, web/config.js, web/_redirects (Netlify)
```

## Run locally

```bash
npm install                      # also generates web/data.js
npm run dev                      # mock mode, no key needed → http://localhost:8787
# real model:
ANTHROPIC_API_KEY=... APP_PASSCODE=team123 npm start
```

## Deploy

You can host it in one of two ways.

### Option A: one Railway service (simplest)

1. Push this folder to your GitHub repo.
2. In Railway, choose **New Project → Deploy from GitHub repo**. `railway.json` sets `npm start` and the `/api/health` health check.
3. Under **Variables**, set:
   - `ANTHROPIC_API_KEY` (yourself);
   - `APP_PASSCODE`;
   - optionally the `MODEL_*` variables (see `.env.example`).
4. Under **Settings → Networking → Generate Domain**, create a domain and share that URL plus the passcode with QC.

### Option B: Netlify frontend with the API on Railway

1. Deploy to Railway as in Option A, adding the variable `SERVE_WEB=0`. Copy the Railway domain.
2. In Netlify, choose **Add new site → Import from Git**, using the same repo. `netlify.toml` already sets the build command and the `web` publish folder.
3. In Netlify **Environment variables**, set `RAILWAY_API_URL=https://<your-app>.up.railway.app` and redeploy.
4. The build writes `web/_redirects`, so `/api/*` on the Netlify domain is proxied to Railway. Same-origin calls mean no CORS setup is needed.

## Models: why they are pinned

Results change when the model changes. Each tier is therefore pinned to an exact model ID through env vars, and temperature is set to `0`:

| Tier | Used for | Default |
|---|---|---|
| quick | prompt suggestions, refine suggestions, filter suggestion | `claude-haiku-5-5` |
| default | interpreter | `claude-sonnet-5-5` |
| complex | interpreter (switch in Settings or Benchmark) | `claude-opus-5-5` |

The model that actually answered is shown in several places:
- the **Token Usage** log field;
- the Settings tab;
- the benchmark CSV.

This lets every benchmark run be traced to its model. If you change a model, re-run the benchmark and compare the CSVs.

The static part of the interpreter prompt is about 5k tokens: schema, value lists and rules. It is sent as a cached system block, so repeat calls are faster and cheaper. Token Usage shows the cached share.

## Security

- **API key.** The Anthropic key lives only in the Railway env var. It is never sent to the browser.
- **No open endpoint.** The API takes structured inputs (query, tab, org, tier), not free prompts, so it can't be used as a general LLM endpoint.
- **Passcode.** `APP_PASSCODE` is required in the `x-app-passcode` header. Users enter it once per browser, and **Settings → Forget passcode** clears it.
- **Limits.** Requests are rate-limited per IP (`RATE_LIMIT_PER_MIN`, default 60). Query length is capped at 600 characters.

## What QC can do

**Dashboard**
- AI suggestions, with up to 5 regenerations before they cycle;
- Recent AI Searches;
- a focus pop-up with an "AI Search 'query' ↵" row.

**Discover**
- AI Search fills the left-hand filters;
- a "Not applied" strip lists unresolved and unsupported parts;
- the refine dropdown opens when the search box is focused;
- after a manual change to Revenue, Headcount, Seniority, Department or Persona, a filter suggestion appears as a "+ value" chip, with ✓ to accept or 👎 to reject;
- rejecting a suggestion opens the feedback box.

**Ctrl/⌘+K** opens the Spotlight search.

**Mic** uses real speech-to-text in Chrome and Edge. Other browsers fall back to typing.

**Interpretation log** (top right), with five tabs:
- **Log:** all 17 IG-17053 fields;
- **Validator:** decisions such as blocked values and single-select conflicts;
- **Raw JSON:** the model's raw output;
- **Suggestion log:** the history of filter suggestions;
- **Settings:** eval date, Org A/Org B context, model tier.

**Benchmark**
- filter by category and polarity, then run N cases;
- see KPIs by slice;
- check each case as Match, Check alternative or Mismatch;
- download the results as CSV.

The interpreter never sees the expected answers.

## Tuning workflow

1. Edit the rules in `server/src/prompts.js`, the decision rules (R01–R20) in `data/ais-data.json`, or the validator in `web/app.js` (`validate`, `canonValue`).
2. Restart and run the benchmark on a fixed slice, for example all cases at the default tier.
3. Compare the CSV with the previous run. Keep the change only if the scores improve without new mismatches in negative cases.

## Known limits

- Result rows are samples. The prototype builds the structured query but does not search real data.
- Company, technology and location checks use the snapshot in `data/ais-data.json`.
- Intent filters are shown as "Not enabled", matching the test org.
- Salesforce filters are out of scope, as in the gold set.
- Recent searches, settings and the passcode are stored per browser (localStorage).
