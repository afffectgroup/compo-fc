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
  // Une ligne par équipe de la famille : « ✅ Victoire de Julien (2-1) contre Équipe IA 5 »
  const first=n=>String(n||"").split(" ")[0];
  function teamLine(m,id){
    const home=m.hId===id,my=home?m.hs:m.as,op=home?m.as:m.hs,opName=home?m.aName:m.hName,me=first(home?m.hName:m.aName);
    let win=my>op?1:my<op?-1:0;
    if(!win&&m.win)win=(m.win==="h")===home?1:-1;
    const lab=win>0?"✅ Victoire":win<0?"❌ Défaite":"🤝 Nul";
    let sc=my+"-"+op;
    if(m.pens){const ph=m.pens.h.filter(x=>x[1]).length,pa=m.pens.a.filter(x=>x[1]).length;sc+=", "+(home?ph+"-"+pa:pa+"-"+ph)+" aux t.a.b."}else if(m.et)sc+=" a.p.";
    const derby=mineIds.has(home?m.aId:m.hId);
    return (derby?"⚔️ Derby · ":"")+lab+" de "+me+" ("+sc+") contre "+(derby?first(opName):opName);
  }
  function block(title,ms){
    const L=["*<{{APP}}|"+title+">*"];const done=new Set();let n=0;
    league.mine.forEach(mm=>{const m=ms.find(x=>x.hId===mm.id||x.aId===mm.id);if(!m||done.has(m))return;done.add(m);
      n++;L.push("");L.push("• "+teamLine(m,mm.id))});
    return n?L.join("\n"):"";
  }
  function results(D){
    const lr=league.results[D];if(!lr)return "";
    return block("⚽ Journée "+(D+1)+" à "+slotHour(D)+"h",lr);
  }
  function cupResults(i){
    const R=league.cup.rounds[i],res=league.cup.results[i];if(!res)return "";
    return block("🏆 Coupe · "+R.name+" à "+CUP_HOUR+"h",res);
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
  return {results,cupResults,reminder,seasonEnd};
})()`;

function playedSlots(league) {
  return Object.keys(league.results || {}).map(Number).sort((a, b) => a - b);
}
function playedCup(league) {
  return league.cup ? league.cup.rounds.map((R, i) => i).filter(i => league.cup.results && league.cup.results[i]) : [];
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
    for (const D of playedSlots(league)) if (!posted.has(D)) { const text = R.results(D); if (text) msgs.push({ kind: "results", slot: D, text }); posted.add(D); }
    const postedCup = new Set(sameLeague ? (meta.postedCup || []) : []);
    for (const i of playedCup(league)) if (!postedCup.has(i)) { const text = R.cupResults(i); if (text) msgs.push({ kind: "cup", round: i, text }); postedCup.add(i); }
    let seasonEndPosted = meta.seasonEnd || null;
    if (w.eval("seasonDone()") && seasonEndPosted !== league.id) { msgs.push({ kind: "season", text: R.seasonEnd() }); seasonEndPosted = league.id; }
    // Pas de rappel séparé : le prochain match et les absents sont ajoutés au dernier message de résultats.
    const k = w.eval("nextDay()");
    const nextSlotAt = w.eval("nextEventAt()");
    
    return {
      league, book, msgs, errors: page.errors, nextSlotAt,
      meta: { ...meta, posted: [...posted], postedCup: [...postedCup], seasonEnd: seasonEndPosted, leagueId: league.id },
    };
  } finally { page.close(); }
}

module.exports = { tick, openPage, playedSlots, playedCup };
