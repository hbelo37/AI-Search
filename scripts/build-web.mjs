// Generates web/data.js (schema + gold set for the browser) and web/config.js (+ Netlify _redirects when RAILWAY_API_URL is set).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const data = readFileSync(path.join(root, "data/ais-data.json"), "utf8");
writeFileSync(path.join(web, "data.js"), `window.AIS_DATA = ${data.trim()};\n`);

// API base: empty = same origin (Railway single service, or Netlify proxy below). Set API_BASE_URL to call Railway directly (needs ALLOWED_ORIGINS on the API).
const base = (process.env.API_BASE_URL || "").replace(/\/$/, "");
writeFileSync(path.join(web, "config.js"), `window.AIS_API_BASE = ${JSON.stringify(base)};\n`);

const railway = (process.env.RAILWAY_API_URL || "").replace(/\/$/, "");
if (railway) {
  writeFileSync(path.join(web, "_redirects"), `/api/*  ${railway}/api/:splat  200\n`);
  console.log("[build-web] Netlify proxy /api/* ->", railway);
}
console.log("[build-web] wrote web/data.js and web/config.js");
