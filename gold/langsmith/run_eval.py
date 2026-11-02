"""Run an experiment. Replace `target` with a call to your AI Search interpreter + an adapter to the output shape in evaluators.py."""
import os
from langsmith import evaluate
from evaluators import ROW_EVALUATORS, SUMMARY_EVALUATORS, make_llm_judge

def target(inputs: dict) -> dict:
    # 1. freeze the clock to inputs["eval_date"] and load inputs["fixture"] context (see Fixtures sheet)
    # 2. call AI Search with inputs["query"] on inputs["search_tab"]
    # 3. convert the response to: primary_entity, applied_conditions, not_applied_conditions,
    #    validation_status, partial_resolution, ambiguous, keyword_fallback, log (17 fields)
    raise NotImplementedError("plug in your AI Search call + adapter")

evaluators = list(ROW_EVALUATORS)
# Optional free-text judge (must-not assertions, acceptable alternatives, Intent / Conditions):
# from langchain_anthropic import ChatAnthropic
# llm = ChatAnthropic(model="<model>", temperature=0)
# evaluators.append(make_llm_judge(lambda p: llm.invoke(p).content))

# Free-plan friendly defaults: 1 repetition, optional split filter (e.g. SPLIT=edge or SPLIT=negative)
from langsmith import Client
DATASET = os.getenv("GOLD_DATASET", "ai-search-nlp-to-filters-gold")
SPLIT = os.getenv("SPLIT")            # golden | edge | positive | negative | mixed | C01…C17 | (unset = all 394)
REPS = int(os.getenv("REPS", "1"))    # 1 ≈ 378 traces per full run; 3 for stability checks
data = Client().list_examples(dataset_name=DATASET, splits=[SPLIT]) if SPLIT else DATASET

results = evaluate(
    target,
    data=data,
    evaluators=evaluators,
    summary_evaluators=SUMMARY_EVALUATORS,
    experiment_prefix="ai-search",
    num_repetitions=REPS,
    max_concurrency=4,
)
