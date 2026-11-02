// Thin wrapper over the Anthropic Messages API with pinned model IDs and tolerant JSON parsing.
import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  quick: process.env.MODEL_QUICK || "claude-haiku-5-5",
  default: process.env.MODEL_DEFAULT || "claude-sonnet-5-5",
  complex: process.env.MODEL_COMPLEX || "claude-opus-5-5",
};
const TEMPERATURE = process.env.TEMPERATURE === undefined ? 0 : Number(process.env.TEMPERATURE);
const MOCK = process.env.MOCK_LLM === "1";
let client = null;
if (!MOCK) {
  if (!process.env.ANTHROPIC_API_KEY) console.warn("[ai-search] ANTHROPIC_API_KEY is not set – AI calls will fail. Set MOCK_LLM=1 to run without a key.");
  client = new Anthropic(); // reads ANTHROPIC_API_KEY
}

export function parseJSON(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const s = Math.min(...["{", "["].map(c => t.indexOf(c)).filter(i => i >= 0));
  const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (Number.isFinite(s) && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
  const err = new Error("The model reply was not valid JSON"); err.code = "invalid_json"; err.raw = t.slice(0, 2000); throw err;
}

/**
 * @param {{system?: string, user: string, tier?: "quick"|"default"|"complex", maxTokens?: number, mock?: () => any}} o
 * @returns {Promise<{json:any, model:string, ms:number, usage:{input_tokens:number, output_tokens:number, cache_read_input_tokens?:number}}>}
 */
export async function completeJSON({ system, user, tier = "default", maxTokens = 4000, mock }) {
  const model = MODELS[tier] || MODELS.default;
  const t0 = Date.now();
  if (MOCK) {
    await new Promise(r => setTimeout(r, 120));
    return { json: mock ? mock(user) : {}, model: model + " (mock)", ms: Date.now() - t0, usage: { input_tokens: 0, output_tokens: 0 } };
  }
  const params = { model, max_tokens: maxTokens, messages: [{ role: "user", content: user }] };
  if (Number.isFinite(TEMPERATURE)) params.temperature = TEMPERATURE;
  if (system) params.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const res = await client.messages.create(params);
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
  return { json: parseJSON(text), model: res.model, ms: Date.now() - t0, usage: res.usage };
}
