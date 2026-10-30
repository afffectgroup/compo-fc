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
// Un code par personne : CODE_JULIEN=…, CODE_YOAN=… (ACCESS_KEY = code administrateur, peut tout modifier).
const USERS = Object.entries(process.env).filter(([k, v]) => /^CODE_[A-Z0-9_]+$/.test(k) && v)
  .map(([k, v]) => ({ name: k.slice(5).charAt(0) + k.slice(6).toLowerCase(), code: v }));
if (ACCESS_KEY) USERS.push({ name: "admin", code: ACCESS_KEY });
const AUTH_ON = USERS.length > 0;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const APP_URL = (process.env.APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN && "https://" + process.env.RAILWAY_PUBLIC_DOMAIN || "https://compo-fc-production.up.railway.app").replace(/\/$/, "");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const SEED_FILE = path.join(__dirname, "seed", "state.json");

// ---------- Stockage ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
function loadStore() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const seed = fs.existsSync(SEED_FILE) ? JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) : { docs: {} };
  const store = { docs: seed.docs || {}, meta: {} };
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
// Chaque équipe appartient à quelqu'un : attribuée d'après le nom (« Julien Déniel » → Julien).
function assignOwners() {
  const b = store.docs.book;
  if (!b || !Array.isArray(b.teams)) return;
  const names = USERS.filter(u => u.name !== "admin").map(u => u.name);
  b.teams.forEach(t => { if (!t.owner) { const n = names.find(n => (t.name || "").toLowerCase().includes(n.toLowerCase())); if (n) t.owner = n; } });
}
assignOwners();
persist();

// ---------- Fusion des écritures venant des navigateurs ----------
function mergeBook(cur, inc, user) {
  if (!cur || !Array.isArray(cur.teams)) return { teams: inc.teams || [], cur: inc.cur || 0 };
  const byId = new Map(cur.teams.map(t => [t.id, t]));
  const mayEdit = t => !AUTH_ON || user === "admin" || !t || !t.owner || t.owner === user;
  const deleted = new Set((inc.deleted || []).filter(id => mayEdit(byId.get(id))));
  const order = [];
  for (const t of inc.teams || []) {
    const old = byId.get(t.id);
    if (!old) order.push({ ...t, owner: t.owner || (user && user !== "admin" ? user : undefined) });
    else if (mayEdit(old) && (t.ts || 0) >= (old.ts || 0)) order.push({ ...t, owner: old.owner || t.owner });
    else order.push(old);
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
  const link = APP_URL ? `\nLa suite sur ${APP_URL}/` : "";
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
    if (!force && next && Date.now() < next) return; // rien à jouer avant la prochaine journée
    const res = tick(store.docs, store.meta);
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
const STATIC = { "/favicon.svg": "image/svg+xml", "/favicon-16.png": "image/png", "/favicon-32.png": "image/png", "/favicon-48.png": "image/png", "/favicon.ico": "image/x-icon", "/apple-touch-icon.png": "image/png", "/icon-512.png": "image/png", "/icon-192.png": "image/png", "/icon-maskable-512.png": "image/png", "/manifest.webmanifest": "application/manifest+json" };
const cookieOf = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(x => x[0]));
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const userOfCode = k => { if (!k) return null; const u = USERS.find(u => same(k, u.code)); return u ? u.name : null; };
const okKey = k => !!userOfCode(k);
const userOf = req => AUTH_ON ? userOfCode(decodeURIComponent(cookieOf(req).k || "")) : "admin";
const authed = req => !!userOf(req);
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
const LOGIN_PAGE = fs.readFileSync(path.join(__dirname, "web", "login.html"), "utf8");
const LOGIN = LOGIN_PAGE.replace("<!--ERRCLASS-->", "").replace("<!--ERROR-->", "");
const LOGIN_ERR = LOGIN_PAGE.replace("<!--ERRCLASS-->", "err").replace("<!--ERROR-->", '<p class="msg" id="m" role="alert">Code incorrect, réessaie.</p>');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && STATIC[p]) return send(res, 200, fs.readFileSync(path.join(WEB, p.slice(1))), STATIC[p], { "cache-control": "public, max-age=86400" });
    if (p === "/login") {
      if (req.method === "POST") {
        const k = new URLSearchParams(await readBody(req, 1e4)).get("k") || "";
        if (okKey(k)) return send(res, 303, "", "text/plain", { location: "/", "set-cookie": `k=${encodeURIComponent(k)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000` });
        return send(res, 401, LOGIN_ERR, "text/html; charset=utf-8");
      }
      return send(res, 200, LOGIN, "text/html; charset=utf-8");
    }
    if (!authed(req)) {
      if (p.startsWith("/api/")) return send(res, 401, { error: "auth" });
      return send(res, 303, "", "text/plain", { location: "/login" });
    }
    if (p === "/api/me") return send(res, 200, { user: userOf(req) });
    if (p === "/api/docs" && req.method === "GET") {
      return send(res, 200, { docs: Object.entries(store.docs).map(([id, data]) => ({ id, data })) });
    }
    const m = p.match(/^\/api\/docs\/([A-Za-z0-9_\-.]{1,80})$/);
    if (m && req.method === "PUT") {
      const id = m[1], data = JSON.parse(await readBody(req));
      if (id === "book") store.docs.book = mergeBook(store.docs.book, data, userOf(req));
      else if (id === "league") store.docs.league = mergeLeague(store.docs.league, data);
      else store.docs[id] = data;
      persist();
      if (id === "league" || id === "book") store.meta.nextAt = 0; // recalcul de la prochaine journée
      return send(res, 200, { ok: true });
    }
    if (p === "/api/tick" && req.method === "POST") { await runTick(true); return send(res, 200, { ok: true, meta: store.meta }); }
    if (p === "/api/test-slack" && req.method === "POST") { await slack("✅ Compo FC est bien connecté à ce canal."); return send(res, 200, { ok: true }); }
    if (req.method === "GET" && (p === "/" || p === "/index.html")) return send(res, 200, fs.readFileSync(path.join(WEB, "index.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && STATIC[p]) return send(res, 200, fs.readFileSync(path.join(WEB, p.slice(1))), STATIC[p], { "cache-control": "public, max-age=86400" });
    if (req.method === "GET" && p === "/sw.js") return send(res, 200, fs.readFileSync(path.join(WEB, "sw.js")), "text/javascript; charset=utf-8", { "service-worker-allowed": "/" });
    if (req.method === "GET" && p === "/shim.js") return send(res, 200, fs.readFileSync(path.join(WEB, "shim.js")), "text/javascript; charset=utf-8");
    return send(res, 404, { error: "introuvable" });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "serveur" });
  }
});
server.listen(PORT, () => console.log(`Compo FC sur :${PORT} (TZ=${process.env.TZ}, données=${DATA_DIR}, slack=${SLACK_WEBHOOK_URL ? "oui" : "non"}, accès=${USERS.map(u => u.name).join("/") || "ouvert"})`));
