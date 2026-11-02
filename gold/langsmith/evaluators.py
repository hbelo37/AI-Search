"""
LangSmith evaluators for the AI Search (NLP → Filters) gold set.

Row-level evaluators take (outputs, reference_outputs) – LangSmith passes them automatically.
`outputs` is what YOUR target function returns; it must follow the same shape as the reference:

{
  "primary_entity": "Lead" | "Account" | "Unknown",
  "applied_conditions": [ {"filter_id": "seniority", "operator": "Include"|"Exclude"|"Range"|"Radius",
                           "values": ["VP"], "min": null, "max": null}, ... ],
  "not_applied_conditions": [ {"text": "female CEO", "filter_id": null, "status": "Unsupported"|"Unresolved"}, ... ],
  "validation_status": "Valid" | "Valid – partial" | "No executable query",
  "partial_resolution": bool, "ambiguous": bool, "keyword_fallback": bool,
  "log": { <the 17 IG-17053 log fields> }
}

Write a small adapter in your target that converts the AI Search response into this shape
(filter_id = the 'Filter ID' column of sheet 1; values = canonical app values, companies/technologies
as "Name [ID]").

Scores are 0–1 unless noted. Alternatives ("acceptable_alternative") and must-not assertions are free text,
so they are checked by the optional LLM judge at the bottom (make_llm_judge).
"""
from __future__ import annotations
import json, os, re
from collections import defaultdict

_REF = json.load(open(os.path.join(os.path.dirname(__file__), "schema_reference.json"), encoding="utf-8"))
_DEPT = _REF["department"]
_IND = _REF["industry"]
_IND_CHILDREN = defaultdict(list)
for _n, _d in _IND.items():
    if _d["parent"]:
        _IND_CHILDREN[_d["parent"]].append(_n)
LOG_FIELDS = ["User Query","Intent","Primary Entity","Conditions","Filters","Values","Normalization","Selection Type","Include/Exclude",
              "Unsupported","Ambiguous","Keyword Fallback","Partial Resolution","Final Structured Query","Output Validity","Latency","Token Usage"]
KEYWORD_FIDS = {"contact_keywords", "company_keywords"}


# ------------------------------------------------------------------ helpers
def _norm(v) -> str:
    return re.sub(r"\s+", " ", str(v)).strip().lower()

def _norm_kw(v) -> str:
    v = re.sub(r"[^\w\s/+&.-]", "", _norm(v))
    return v[:-1] if v.endswith("s") and len(v) > 3 else v

def _leaf_industries(name):
    kids = _IND_CHILDREN.get(name)
    if not kids:
        return {name}
    out = set()
    for k in kids:
        out |= _leaf_industries(k)
    return out

def _expand(fid, value):
    """Expand hierarchical values to leaves so 'Sales (All)' == all Sales sub-functions."""
    if fid == "department":
        m = re.match(r"^(.*) \(All\)$", value)
        if m and m.group(1) in _DEPT:
            return {f"{m.group(1)} › {s}" for s in _DEPT[m.group(1)]}
        return {value}
    if fid == "industry" and value in _IND:
        return _leaf_industries(value)
    return {value}

def _tuples(conds):
    """Applied conditions → set of comparable tuples (filter, operator, value)."""
    out = set()
    for c in conds or []:
        fid = c.get("filter_id")
        op = c.get("operator") or "Include"
        op = "Include" if op in ("Range", "Radius") else op
        for v in c.get("values") or []:
            for leaf in _expand(fid, v):
                out.add((fid, op, _norm_kw(leaf) if fid in KEYWORD_FIDS else _norm(leaf)))
        if c.get("min") is not None:
            out.add((fid, "min", float(c["min"])))
        if c.get("max") is not None:
            out.add((fid, "max", float(c["max"])))
    return out

def _prf(pred: set, gold: set):
    if not pred and not gold:
        return 1.0, 1.0, 1.0
    tp = len(pred & gold)
    p = tp / len(pred) if pred else 0.0
    r = tp / len(gold) if gold else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f

def _has_alt(ref):
    return any(c.get("acceptable_alternative") for c in ref.get("applied_conditions", []) + ref.get("not_applied_conditions", []))


# ------------------------------------------------------------------ row-level evaluators
def entity_accuracy(outputs: dict, reference_outputs: dict) -> dict:
    return {"key": "entity_accuracy", "score": float(outputs.get("primary_entity") == reference_outputs["primary_entity"])}

def filter_scores(outputs: dict, reference_outputs: dict) -> list[dict]:
    pred = {c.get("filter_id") for c in outputs.get("applied_conditions") or []}
    gold = {c["filter_id"] for c in reference_outputs["applied_conditions"]}
    p, r, f = _prf(pred, gold)
    return [{"key": "filter_precision", "score": p}, {"key": "filter_recall", "score": r}, {"key": "filter_f1", "score": f}]

def value_scores(outputs: dict, reference_outputs: dict) -> list[dict]:
    pred, gold = _tuples(outputs.get("applied_conditions")), _tuples(reference_outputs["applied_conditions"])
    # value metrics only on filters the model got right (avoid double-penalising filter misses)
    shared = {t[0] for t in gold} & {t[0] for t in pred}
    p, r, _ = _prf({t for t in pred if t[0] in shared}, {t for t in gold if t[0] in shared})
    return [{"key": "value_precision", "score": p}, {"key": "value_recall", "score": r}]

def operator_accuracy(outputs: dict, reference_outputs: dict) -> list[dict]:
    gold = {(c["filter_id"], c["operator"]) for c in reference_outputs["applied_conditions"] if c["operator"] in ("Include", "Exclude")}
    if not gold:
        return []   # not applicable to this example
    pred = {(c.get("filter_id"), c.get("operator")) for c in outputs.get("applied_conditions") or []}
    return [{"key": "operator_accuracy", "score": len(gold & pred) / len(gold)}]

def boundary_accuracy(outputs: dict, reference_outputs: dict) -> list[dict]:
    gold = {t for t in _tuples(reference_outputs["applied_conditions"]) if t[1] in ("min", "max")}
    if not gold:
        return []   # not applicable
    pred = {t for t in _tuples(outputs.get("applied_conditions")) if t[1] in ("min", "max")}
    return [{"key": "boundary_accuracy", "score": len(gold & pred) / len(gold)}]

def final_query_exact(outputs: dict, reference_outputs: dict) -> dict:
    ok = _tuples(outputs.get("applied_conditions")) == _tuples(reference_outputs["applied_conditions"])
    comment = "" if ok or not _has_alt(reference_outputs) else "Mismatch, but the reference lists acceptable alternatives – check with the LLM judge"
    return {"key": "final_query_exact", "score": float(ok), "comment": comment}

def overreach_rate(outputs: dict, reference_outputs: dict) -> dict:
    pred, gold = _tuples(outputs.get("applied_conditions")), _tuples(reference_outputs["applied_conditions"])
    extra = {t for t in pred if t[0] not in {g[0] for g in gold}}   # whole extra filters only
    return {"key": "overreach_rate", "score": len(extra) / len(pred) if pred else 0.0}   # lower is better

def negative_handling(outputs: dict, reference_outputs: dict) -> list[dict]:
    exp = reference_outputs["not_applied_conditions"]
    if not exp:
        return []   # not applicable
    got = outputs.get("not_applied_conditions") or []
    flagged = min(len(got), len(exp)) / len(exp)
    silent_drop = float(len(got) == 0)
    return [{"key": "unresolved_flagged", "score": flagged}, {"key": "silent_drop", "score": silent_drop}]   # silent_drop: lower is better

def hallucination(outputs: dict, reference_outputs: dict) -> dict:
    bad = []
    for c in outputs.get("applied_conditions") or []:
        fid = c.get("filter_id")
        if fid not in _REF["filters"]:
            bad.append(f"unknown filter {fid}")
            continue
        allowed = _REF["enumerated"].get(fid)
        if allowed:
            for v in c.get("values") or []:
                if v not in allowed:
                    bad.append(f"{fid}: '{v}' not a valid value")
        if c.get("operator") == "Exclude" and "Exclude" not in _REF["filters"][fid]["operators"]:
            bad.append(f"{fid}: Exclude not supported")
    return {"key": "hallucination", "score": float(bool(bad)), "comment": "; ".join(bad)}   # lower is better

def flag_accuracy(outputs: dict, reference_outputs: dict) -> list[dict]:
    res = []
    for k in ("validation_status", "partial_resolution", "ambiguous", "keyword_fallback"):
        res.append({"key": f"{k}_match", "score": float(outputs.get(k) == reference_outputs[k])})
    return res

def log_completeness(outputs: dict, reference_outputs: dict) -> list[dict]:
    """Each of the 17 log fields must be filled when the reference fills it and blank when the reference leaves it blank."""
    ref_log, log = reference_outputs["log"], outputs.get("log") or {}
    exact = {"Primary Entity", "Ambiguous", "Partial Resolution", "Output Validity"}
    ok_fields, wrong = 0, []
    for f in LOG_FIELDS:
        exp_filled = str(ref_log.get(f, "")).strip() != ""
        got = str(log.get(f, "") if log.get(f) is not None else "").strip()
        ok = (got != "") == exp_filled
        if ok and f in exact and exp_filled:
            ok = _norm(got) == _norm(ref_log[f])
        ok_fields += ok
        if not ok:
            wrong.append(f)
    return [{"key": "log_fields_correct", "score": ok_fields / len(LOG_FIELDS), "comment": ("Wrong: " + ", ".join(wrong)) if wrong else ""},
            {"key": "output_valid", "score": float(_norm(log.get("Output Validity", "")) == "valid")}]

ROW_EVALUATORS = [entity_accuracy, filter_scores, value_scores, operator_accuracy, boundary_accuracy, final_query_exact,
                  overreach_rate, negative_handling, hallucination, flag_accuracy, log_completeness]


# ------------------------------------------------------------------ summary evaluators (whole experiment)
def positive_negative_split(runs, examples) -> list[dict]:
    """Final-query accuracy reported separately for positive / negative / mixed examples."""
    buckets = defaultdict(list)
    for run, ex in zip(runs, examples):
        ok = _tuples((run.outputs or {}).get("applied_conditions")) == _tuples(ex.outputs["applied_conditions"])
        buckets[ex.metadata.get("polarity", "?")].append(ok)
    return [{"key": f"final_query_exact_{k.lower()}", "score": sum(v) / len(v)} for k, v in buckets.items()]

def consistency_rate(runs, examples) -> dict:
    """Examples sharing a consistency_group (paraphrases) must produce identical applied conditions."""
    groups = defaultdict(list)
    for run, ex in zip(runs, examples):
        g = ex.metadata.get("consistency_group")
        if g and not g.startswith("NUM-"):
            groups[g].append(frozenset(_tuples((run.outputs or {}).get("applied_conditions"))))
    groups = {g: v for g, v in groups.items() if len(v) > 1}
    if not groups:
        return {"key": "consistency_rate", "score": None}
    return {"key": "consistency_rate", "score": sum(len(set(v)) == 1 for v in groups.values()) / len(groups)}

def per_filter_accuracy(runs, examples) -> list[dict]:
    """Recall of expected (filter, value) tuples per filter – shows which filters are weak."""
    hit, tot = defaultdict(int), defaultdict(int)
    for run, ex in zip(runs, examples):
        gold, pred = _tuples(ex.outputs["applied_conditions"]), _tuples((run.outputs or {}).get("applied_conditions"))
        for t in gold:
            tot[t[0]] += 1
            hit[t[0]] += t in pred
    return [{"key": f"recall__{fid}", "score": hit[fid] / tot[fid]} for fid in sorted(tot)]

SUMMARY_EVALUATORS = [positive_negative_split, consistency_rate, per_filter_accuracy]


# ------------------------------------------------------------------ optional LLM judge (free-text checks)
JUDGE_PROMPT = """You are grading an AI search interpreter. Answer only with JSON.
User query: {query}
Reference (expected) result: {reference}
Model result: {output}

1. must_not_ok: true if NONE of these must-not items appear in the model result: {must_not}
2. alternative_ok: true if the model result matches the reference OR any 'acceptable_alternative' listed in the reference.
3. intent_ok: true if the model's Intent log field means the same as the reference Intent.
4. conditions_ok: true if the model's Conditions log field covers the same requirements as the reference Conditions.
Return: {{"must_not_ok": bool, "alternative_ok": bool, "intent_ok": bool, "conditions_ok": bool, "reason": "<one sentence>"}}"""

def make_llm_judge(llm_call):
    """llm_call: any function (prompt: str) -> str  (e.g. wraps OpenAI / Anthropic / LangChain chat model)."""
    def llm_judge(inputs: dict, outputs: dict, reference_outputs: dict) -> list[dict]:
        prompt = JUDGE_PROMPT.format(query=inputs["query"], reference=json.dumps(reference_outputs, ensure_ascii=False),
                                     output=json.dumps(outputs, ensure_ascii=False),
                                     must_not=json.dumps([m["assertion"] for m in reference_outputs.get("must_not", [])], ensure_ascii=False))
        raw = llm_call(prompt)
        try:
            j = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
        except Exception:
            return [{"key": "judge_error", "score": 1.0, "comment": raw[:300]}]
        return [{"key": k, "score": float(bool(j.get(k))), "comment": j.get("reason", "")} for k in ("must_not_ok", "alternative_ok", "intent_ok", "conditions_ok")]
    return llm_judge
