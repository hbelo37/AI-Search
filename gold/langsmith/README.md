# AI Search gold set – LangSmith package

| File | Purpose |
|---|---|
| `ai_search_gold.jsonl` | 394 LangSmith examples: `inputs` (query, search tab, eval date, fixture), `outputs` (reference answer incl. all 17 log fields and must-not list), `metadata` (case id, category, polarity, rules, consistency group, filters), `split` (golden/edge + positive/negative/mixed + primary category C01–C17). |
| `upload_dataset.py` | Creates the dataset in LangSmith and uploads the examples (`python upload_dataset.py [dataset-name]`). |
| `evaluators.py` | Code evaluators (entity, filter P/R/F1, value P/R, operator, boundary, final query, overreach, unresolved-flagged, silent drop, hallucination, flags, 17 log fields, output validity) + summary evaluators (positive vs negative accuracy, paraphrase consistency, per-filter recall) + optional LLM judge for must-not / alternatives / Intent / Conditions. |
| `run_eval.py` | Experiment runner – plug in your AI Search call + adapter in `target()`. |
| `schema_reference.json` | Filter metadata, value lists and department/industry hierarchies used by the evaluators. |

Lower is better for: `overreach_rate`, `silent_drop`, `hallucination`. Everything else: higher is better (0–1).

Setup: `pip install -U langsmith`, set `LANGSMITH_API_KEY`, run `python upload_dataset.py`, implement `target()` in `run_eval.py`, then `python run_eval.py`.
Run subsets with splits, e.g. only edge cases or only negatives.
