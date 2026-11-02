"""Upload the AI Search gold set to LangSmith.
pip install -U langsmith ; export LANGSMITH_API_KEY=...   (and LANGSMITH_ENDPOINT if self-hosted / EU)"""
import json, sys
from langsmith import Client

DATASET = sys.argv[1] if len(sys.argv) > 1 else "ai-search-nlp-to-filters-gold"
client = Client()
if client.has_dataset(dataset_name=DATASET):
    sys.exit(f"Dataset '{DATASET}' already exists – pass a new name or delete it first.")
ds = client.create_dataset(dataset_name=DATASET,
    description="Gold set for AI Search (IG-17053 / IG-17217): 394 prompts with expected filters, unresolved conditions, must-not assertions and all 17 log fields.")
from langsmith import schemas
_fields = getattr(schemas.ExampleCreate, "model_fields", {})
_out_key = "reference_outputs" if "reference_outputs" in _fields else "outputs"   # SDK >= 0.14 renamed outputs → reference_outputs
examples = []
for line in open("ai_search_gold.jsonl", encoding="utf-8"):
    e = json.loads(line)
    e[_out_key] = e.pop("outputs")
    examples.append(e)
for i in range(0, len(examples), 100):          # batches of 100
    client.create_examples(dataset_id=ds.id, examples=examples[i:i + 100])
print(f"Uploaded {len(examples)} examples to '{DATASET}'. Splits: golden / edge and positive / negative / mixed.")
