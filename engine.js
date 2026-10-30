// Exécute le moteur de la page (le même code que dans le navigateur) côté serveur, dans jsdom.
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const PAGE = fs
  .readFileSync(path.join(__dirname, "web", "index.html"), "utf8")
  .replace('<script>window.SERVER_SIM=true</script>\n<script src="/shim.js"></script>\n', "");

const KEYS = { book: "compo-fc-teams-v1", league: "compo-fc-league-v1", matches: "compo-fc-matches-v1" };

// Ouvre la page avec l'état donné. Le chargement joue automatiquement les journées dont l'heure est passée.
function openPage(docs) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => errors.push(String(e && e.message || e)));
  const dom = new JSDOM(PAGE, {
    url: "http://localhost/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      for (const [id, key] of Object.entries(KEYS)) if (docs[id]) w.localStorage.setItem(key, JSON.stringify(docs[id]));
      if (process.env.FAKE_NOW) w.eval(`(()=>{const T=new Date(${JSON.stringify(process.env.FAKE_NOW)}).getTime(),D=Date,off=T-D.now();window.Date=class extends D{constructor(...a){a.length?super(...a):super(D.now()+off)}static now(){return D.now()+off}}})()`);
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = () => {};
    },
  });
  const w = dom.window;
  // initCloud échoue (pas de claude.use) puis lance runLeague : on s'assure qu'il a bien tourné.
  w.eval("leagueReady=true;runLeague();");
  return { w, errors, close: () => w.close() };
}

// Code exécuté dans la page pour fabriquer les messages.
const REPORT_JS = String.raw`
(function(){
  const fmtSlot=D=>fmtDate(dstr(roundDate(D)))+" "+slotHour(D)+"h";
  const mineIds=new Set(league.mine.map(m=>m.id));
  const nm=id=>lgTeam(id).name;
  const minute=g=>g.m+"'"+(g.pen?" (pén.)":g.fk?" (CF)":g.og?" (csc)":"");
  function matchLines(m,detail){
    const H=mineIds.has(m.hId),A=mineIds.has(m.aId);
    let score=m.hs+" – "+m.as;
    if(m.pens)score+=" ("+m.pens[0]+"–"+m.pens[1]+" tab)";else if(m.et)score+=" (a.p.)";
    const line=(H?"*"+m.hName+"*":m.hName)+"  "+score+"  "+(A?"*"+m.aName+"*":m.aName);
    if(!detail||(!H&&!A))return [line];
    const out=[line];
    const goals=s=>(m.goals||[]).filter(g=>g.side===s).map(g=>(g.og?g.n+" csc":shortName(g.n))+" "+g.m+"'"+(g.pen?" (pén.)":""));
    const gh=goals("h"),ga=goals("a");
    if(gh.length||ga.length)out.push("   ⚽ "+[gh.length?m.hName+" : "+gh.join(", "):null,ga.length?m.aName+" : "+ga.join(", "):null].filter(Boolean).join(" · "));
    if(m.motm)out.push("   ⭐ Homme du match : "+m.motm);
    const reds=(m.cards||[]).filter(c=>c.t!=="Y").map(c=>"🟥 "+c.n+(c.d?" ("+c.d+" match"+(c.d>1?"s":"")+")":""));
    const inj=(m.inj||[]).map(i=>"🚑 "+i.n+" ("+i.d+" match"+(i.d>1?"s":"")+")");
    if(reds.length||inj.length)out.push("   "+[...reds,...inj].join(" · "));
    return out;
  }
  function results(D){
    const L=[];
    const lr=league.results[D];
    if(lr){
      L.push("*⚽ Journée "+(D+1)+"/"+league.schedule.length+" · "+fmtSlot(D)+"*");
      lr.filter(m=>mineIds.has(m.hId)||mineIds.has(m.aId)).forEach(m=>L.push(...matchLines(m,true)));
      const others=lr.filter(m=>!mineIds.has(m.hId)&&!mineIds.has(m.aId));
      if(others.length){L.push("_Autres matchs_");others.forEach(m=>L.push(...matchLines(m,false)))}
    }
    if(league.cup)league.cup.rounds.forEach((R,i)=>{const res=league.cup.results[i];if(R.day!==D||!res)return;
      L.push("","*🏆 Coupe · "+R.name+"*");res.forEach(m=>L.push(...matchLines(m,true)));});
    if(lr){
      const st=standings();
      L.push("","*Classement*");
      st.forEach((s,i)=>{if(mineIds.has(s.id))L.push((i+1)+"e · *"+s.name+"* · "+s.pts+" pts ("+s.g+"V "+s.n+"N "+s.p+"D, "+(s.bp-s.bc>=0?"+":"")+(s.bp-s.bc)+")")});
    }
    return L.join("\n");
  }
  function reminder(k){
    refreshAbs();setMods(k);
    const L=["","*➡️ Prochain : "+(dayLabel(k)||"match")+" · "+fmtSlot(k)+"*"];
    league.mine.forEach(mm=>{
      const T=book.teams.find(t=>t.id===mm.id);if(!T)return;
      const fx=[];
      if(league.schedule[k]&&!league.results[k])league.schedule[k].forEach(([h,a])=>{if(h===mm.id)fx.push("contre "+nm(a)+" (dom.)");if(a===mm.id)fx.push("à "+nm(h)+" (ext.)")});
      if(league.cup)league.cup.rounds.forEach((R,i)=>{if(R.day!==k||league.cup.results[i])return;ensureCupTies(i);(R.ties||[]).forEach(([h,a])=>{if(h===mm.id)fx.push("Coupe contre "+nm(a));if(a===mm.id)fx.push("Coupe à "+nm(h))})});
      if(!fx.length)return;
      L.push("*"+T.name+"* · "+fx.join(" puis "));
      const xi=T.xi.filter(Boolean),bench=(T.bench||[]).filter(Boolean);
      const out=xi.filter(n=>statusOf(n,k)).map(n=>{const s=statusOf(n,k);return n+" ("+(s.type==="inj"?"blessé":"suspendu")+", "+s.left+" match"+(s.left>1?"s":"")+")"});
      const bout=bench.filter(n=>statusOf(n,k)).map(n=>n);
      const tired=xi.filter(n=>!statusOf(n,k)&&conditionOf(n,k)<80).map(n=>n+" ("+conditionOf(n,k)+" %)");
      const warn=xi.filter(n=>!statusOf(n,k)&&ABS&&ABS.yc[n]%3===2);
      if(out.length)L.push("   🚫 Titulaires absents : "+out.join(", ")+" → sinon le meilleur remplaçant jouera");
      if(bout.length)L.push("   🪑 Remplaçants indisponibles : "+bout.join(", "));
      if(tired.length)L.push("   🔋 Fatigués : "+tired.join(", "));
      if(warn.length)L.push("   🟨 Menacés de suspension : "+warn.join(", "));
      if(!out.length&&!tired.length&&!warn.length)L.push("   ✅ Rien à signaler");
    });
    return L.join("\n");
  }
  function seasonEnd(){
    const st=standings(),w=st[0];let cupW=null;
    if(league.cup){const res=league.cup.results[cupLast()];if(res&&res[0])cupW=nm(cupWinnerId(res[0]))}
    const L=["*🏁 Fin de la saison "+league.season+"*","🏆 Champion : *"+w.name+"* ("+w.pts+" pts)"];
    if(cupW)L.push("🥇 Vainqueur de la coupe : *"+cupW+"*");
    league.mine.forEach(mm=>{const i=st.findIndex(s=>s.id===mm.id);if(i>=0)L.push(st[i].name+" : "+(i+1)+"e")});
    return L.join("\n");
  }
  return {results,reminder,seasonEnd};
})()`;

function playedSlots(league) {
  const s = new Set(Object.keys(league.results || {}).map(Number));
  if (league.cup) league.cup.rounds.forEach((R, i) => { if (league.cup.results && league.cup.results[i]) s.add(R.day); });
  return [...s].sort((a, b) => a - b);
}

// Joue ce qui doit l'être et renvoie le nouvel état + les messages à poster.
function tick(docs, meta, now = new Date()) {
  const page = openPage(docs);
  const { w } = page;
  try {
    const league = JSON.parse(w.eval("JSON.stringify(league)"));
    const book = JSON.parse(w.eval("JSON.stringify(book)"));
    const R = w.eval(REPORT_JS);
    const msgs = [];
    const sameLeague = !meta.leagueId || meta.leagueId === league.id;
    const posted = new Set(sameLeague ? (meta.posted || []) : []);
    for (const D of playedSlots(league)) if (!posted.has(D)) { msgs.push({ kind: "results", slot: D, text: R.results(D) }); posted.add(D); }
    let seasonEndPosted = meta.seasonEnd || null;
    if (w.eval("seasonDone()") && seasonEndPosted !== league.id) { msgs.push({ kind: "season", text: R.seasonEnd() }); seasonEndPosted = league.id; }
    // Pas de rappel séparé : le prochain match et les absents sont ajoutés au dernier message de résultats.
    const k = w.eval("nextDay()");
    const nextSlotAt = k >= 0 ? w.eval(`roundDate(${k}).getTime()`) : null;
    const last = [...msgs].reverse().find(m => m.kind === "results");
    if (last && k >= 0) last.text += "\n" + R.reminder(k);
    return {
      league, book, msgs, errors: page.errors, nextSlotAt,
      meta: { ...meta, posted: [...posted], seasonEnd: seasonEndPosted, leagueId: league.id },
    };
  } finally { page.close(); }
}

module.exports = { tick, openPage, playedSlots };
