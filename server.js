// Compo FC — serveur : sert l'app, stocke l'état partagé, joue les matchs à l'heure et prévient Slack.
process.env.TZ = process.env.TZ || "Europe/Paris";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { tick, playedSlots } = require("./engine");

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ACCESS_KEY = process.env.ACCESS_KEY || "";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const APP_URL = (process.env.APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN && "https://" + process.env.RAILWAY_PUBLIC_DOMAIN || "").replace(/\/$/, "");
const REMINDER_MINUTES = +process.env.REMINDER_MINUTES || 30;
const STATE_FILE = path.join(DATA_DIR, "state.json");
const SEED_FILE = path.join(__dirname, "seed", "state.json");

// ---------- Stockage ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
function loadStore() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const seed = fs.existsSync(SEED_FILE) ? JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) : { docs: {} };
  const store = { docs: seed.docs || {}, meta: { reminderMinutes: REMINDER_MINUTES } };
  const L = store.docs.league;
  if (L) { store.meta.leagueId = L.id; store.meta.posted = playedSlots(L); } // pas de rattrapage des journées déjà jouées
  return store;
}
let store = loadStore();
function persist() {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, STATE_FILE);
}
persist();

// ---------- Fusion des écritures venant des navigateurs ----------
function mergeBook(cur, inc) {
  if (!cur || !Array.isArray(cur.teams)) return { teams: inc.teams || [], cur: inc.cur || 0 };
  const deleted = new Set(inc.deleted || []);
  const byId = new Map(cur.teams.map(t => [t.id, t]));
  const order = [];
  for (const t of inc.teams || []) {
    const old = byId.get(t.id);
    order.push(!old || (t.ts || 0) >= (old.ts || 0) ? t : old);
    byId.delete(t.id);
  }
  for (const [id, t] of byId) if (!deleted.has(id)) order.push(t); // équipe ajoutée ailleurs entre-temps
  return { teams: order, cur: inc.cur || 0, updated: Date.now() };
}
function mergeLeague(cur, inc) {
  if (!cur || !cur.schedule) return inc;
  if (inc.id !== cur.id) return (inc.season || 0) > (cur.season || 0) ? inc : cur; // nouvelle saison seulement
  const out = { ...inc };
  out.results = { ...(inc.results || {}), ...(cur.results || {}) }; // les résultats du serveur font foi
  if (cur.cup && inc.cup) {
    out.cup = { ...inc.cup, results: { ...(inc.cup.results || {}), ...(cur.cup.results || {}) } };
    out.cup.rounds = inc.cup.rounds.map((R, i) => (cur.cup.rounds[i] && cur.cup.rounds[i].ties && !R.ties ? { ...R, ties: cur.cup.rounds[i].ties } : R));
  }
  if (cur.roster || inc.roster) {
    out.roster = { ...(cur.roster || {}) };
    for (const [id, names] of Object.entries(inc.roster || {})) out.roster[id] = [...new Set([...(out.roster[id] || []), ...names])];
  }
  out.resFull = { ...(inc.resFull || {}), ...(cur.resFull || {}) };
  return out;
}

// ---------- Slack ----------
async function slack(text) {
  if (!SLACK_WEBHOOK_URL) { console.log("[slack désactivé]\n" + text); return; }
  const link = APP_URL ? `\n<${APP_URL}|Ouvrir Compo FC>` : "";
  const r = await fetch(SLACK_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: text + link }) });
  if (!r.ok) throw new Error("Slack " + r.status + " " + (await r.text()));
}

// ---------- Boucle : jouer les journées et poster ----------
let running = false;
async function runTick(force) {
  if (running) return;
  running = true;
  try {
    if (!store.docs.league || !store.docs.book) return;
    const next = store.meta.nextAt || 0;
    if (!force && next && Date.now() < next - REMINDER_MINUTES * 60000 - 60000) return; // rien à faire avant le prochain rappel
    const res = tick(store.docs, { ...store.meta, reminderMinutes: REMINDER_MINUTES });
    if (res.errors.length) console.warn("erreurs moteur:", res.errors.slice(0, 3));
    store.docs.league = res.league; // tick est synchrone : aucune écriture n'a pu arriver entre-temps
    store.meta = { ...res.meta, nextAt: res.nextSlotAt };
    persist();
    for (const m of res.msgs) {
      try { await slack(m.text); } catch (e) { console.error(e.message); }
    }
  } catch (e) {
    console.error("tick:", e);
  } finally { running = false; }
}
setInterval(() => runTick(false), 60000);
setTimeout(() => runTick(true), 3000);

// ---------- HTTP ----------
const WEB = path.join(__dirname, "web");
const cookieOf = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(x => x[0]));
const okKey = k => ACCESS_KEY && k && k.length === ACCESS_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ACCESS_KEY));
const authed = req => !ACCESS_KEY || okKey(decodeURIComponent(cookieOf(req).k || ""));
function send(res, code, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...extra });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 5e6) {
  return new Promise((ok, ko) => {
    let n = 0; const chunks = [];
    req.on("data", c => { n += c.length; if (n > limit) { ko(new Error("trop gros")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", ko);
  });
}
const LOGIN = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compo FC</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1410;color:#eef3ee;font:16px system-ui,sans-serif;padding:16px}form{display:grid;gap:12px;width:min(320px,100%)}input,button{font:inherit;padding:12px;border-radius:10px;border:1px solid #2a3f33;background:#132019;color:inherit}button{background:#7ee08a;color:#08210f;font-weight:700;border:0}</style>
<form method="post" action="/login"><h1 style="margin:0">Compo FC</h1><input name="k" type="password" placeholder="Code d'accès" autofocus required><button>Entrer</button></form></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/health") return send(res, 200, { ok: true });
    if (p === "/login") {
      if (req.method === "POST") {
        const k = new URLSearchParams(await readBody(req, 1e4)).get("k") || "";
        if (okKey(k)) return send(res, 303, "", "text/plain", { location: "/", "set-cookie": `k=${encodeURIComponent(k)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000` });
        return send(res, 401, LOGIN.replace("<button>", '<p style="color:#ff8a7a;margin:0">Code incorrect</p><button>'), "text/html; charset=utf-8");
      }
      return send(res, 200, LOGIN, "text/html; charset=utf-8");
    }
    if (!authed(req)) {
      if (p.startsWith("/api/")) return send(res, 401, { error: "auth" });
      return send(res, 303, "", "text/plain", { location: "/login" });
    }
    if (p === "/api/docs" && req.method === "GET") {
      return send(res, 200, { docs: Object.entries(store.docs).map(([id, data]) => ({ id, data })) });
    }
    const m = p.match(/^\/api\/docs\/([A-Za-z0-9_\-.]{1,80})$/);
    if (m && req.method === "PUT") {
      const id = m[1], data = JSON.parse(await readBody(req));
      if (id === "book") store.docs.book = mergeBook(store.docs.book, data);
      else if (id === "league") store.docs.league = mergeLeague(store.docs.league, data);
      else store.docs[id] = data;
      persist();
      if (id === "league" || id === "book") store.meta.nextAt = 0; // recalcul du prochain rappel
      return send(res, 200, { ok: true });
    }
    if (p === "/api/tick" && req.method === "POST") { await runTick(true); return send(res, 200, { ok: true, meta: store.meta }); }
    if (p === "/api/test-slack" && req.method === "POST") { await slack("✅ Compo FC est bien connecté à ce canal."); return send(res, 200, { ok: true }); }
    if (req.method === "GET" && (p === "/" || p === "/index.html")) return send(res, 200, fs.readFileSync(path.join(WEB, "index.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && p === "/shim.js") return send(res, 200, fs.readFileSync(path.join(WEB, "shim.js")), "text/javascript; charset=utf-8");
    return send(res, 404, { error: "introuvable" });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "serveur" });
  }
});
server.listen(PORT, () => console.log(`Compo FC sur :${PORT} (TZ=${process.env.TZ}, données=${DATA_DIR}, slack=${SLACK_WEBHOOK_URL ? "oui" : "non"})`));
