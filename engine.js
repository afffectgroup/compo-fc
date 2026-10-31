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
    const lab=win>0?"Victoire":win<0?"Défaite":"Nul";
    let sc=my+"-"+op;
    if(m.pens){const ph=m.pens.h.filter(x=>x[1]).length,pa=m.pens.a.filter(x=>x[1]).length;sc+=", "+(home?ph+"-"+pa:pa+"-"+ph)+" aux t.a.b."}else if(m.et)sc+=" a.p.";
    const derby=mineIds.has(home?m.aId:m.hId);
    return (derby?"Derby · ":"")+lab+" de "+me+" ("+sc+") contre "+(derby?first(opName):opName);
  }
  // ---- La une : un gros titre façon presse sportive, tiré du fait le plus marquant de nos matchs ----
  function pickV(arr,seed){let x=0;for(const c of seed)x=(x*31+c.charCodeAt(0))>>>0;return arr[x%arr.length]}
  function headline(ms,key,cupRound){
    const ev=[];
    let stBefore=null,stAfter=null;
    // classement tel qu'il était juste avant / juste après cette journée (pas celui de fin de rattrapage)
    if(!cupRound&&league.results[key]){const all=league.results,upto=k=>{const o={};Object.keys(all).forEach(x=>{if(+x<=k)o[x]=all[x]});return o};
      try{league.results=upto(key);stAfter=standings();league.results=upto(key-1);stBefore=standings()}finally{league.results=all}}
    const pos=(st,id)=>st?st.findIndex(s=>s.id===id)+1:0;
    league.mine.forEach(mm=>{
      const id=mm.id,m=ms.find(x=>x.hId===id||x.aId===id);if(!m)return;
      const home=m.hId===id,me=first(nm(id)),oppId=home?m.aId:m.hId,opp=mineIds.has(oppId)?first(nm(oppId)):nm(oppId);
      const my=home?m.hs:m.as,op=home?m.as:m.hs,side=home?"h":"a";
      let res=my>op?1:my<op?-1:0;if(!res&&m.win)res=(m.win==="h")===home?1:-1;
      const add=(p,arr)=>ev.push({p,t:pickV(arr,league.id+key+me+p)});
      // Derby
      if(mineIds.has(oppId)){if(!home)return;
        const a=first(nm(m.hId)),b=first(nm(m.aId)),w=res>0?a:b,l=res>0?b:a;
        if(m.hs===m.as&&!m.win)add(100,["Partage des points chez les Déniel","Derby sans vainqueur, l'honneur est sauf","Statu quo dans la famille"]);
        else if(Math.abs(m.hs-m.as)>=3)add(110,[w+" écrase "+l+" dans le derby",w+" corrige son frère",l+" humilié par "+w]);
        else add(105,[w+" s'offre le derby",w+" règne sur la famille",l+" s'incline face à son frère"]);
        return}
      // Déroulé du match : remontada, but décisif tardif
      const gs=(m.goals||[]).slice().sort((x,y)=>x.m-y.m);let s1=0,s2=0,worst=0,lastLevelBreak=null;
      gs.forEach(g=>{if(g.side===side)s1++;else s2++;worst=Math.min(worst,s1-s2);if(g.side===side&&s1-s2===1&&s1+s2===my+op&&res>0)lastLevelBreak=g.m});
      if(res>0&&worst<=-2)add(95,[me+" renverse tout",me+" signe une remontada folle","Remontada : "+me+" revient de nulle part"]);
      else if(res>0&&worst<=-1)add(70,[me+" fait preuve de caractère",me+" renverse "+opp,"Mené, "+me+" finit par s'imposer"]);
      if(res>0&&lastLevelBreak>=85&&my-op===1)add(86,[me+" arrache la victoire au bout du suspense",me+" crucifie "+opp+" sur le fil","Coup de théâtre : "+me+" l'emporte à la "+lastLevelBreak+"e"]);
      if(!res&&gs.length&&gs[gs.length-1].side===side&&gs[gs.length-1].m>=85)add(64,[me+" arrache le nul sur le fil",me+" sauve les meubles in extremis"]);
      if(res<0&&op-my>=3)add(90,[me+" humilié par "+opp,"Naufrage pour "+me,me+" sombre face à "+opp,"Soirée cauchemar pour "+me]);
      if(res>0&&my-op>=3)add(80,[me+" écrase "+opp,"Démonstration de "+me,me+" déroule face à "+opp]);
      // Exploits individuels
      const sc={};gs.filter(g=>g.side===side&&!g.og).forEach(g=>sc[g.n]=(sc[g.n]||0)+1);
      Object.entries(sc).forEach(([n,k])=>{if(k>=3)add(78,["Triplé de "+shortName(n)+", "+me+" jubile",shortName(n)+" porte "+me+" avec un triplé"])});
      const T=book.teams.find(t=>t.id===id);const resv=(T&&T.resv)||[];
      Object.keys(sc).forEach(n=>{if(resv.includes(n))add(62,["Le jeune "+shortName(n)+" fait briller "+me,shortName(n)+", la pépite de "+me+", fait trembler les filets"])});
      // Coups durs
      (m.cards||[]).filter(c=>c.side===side&&c.t!=="Y").forEach(c=>add(52,["Coup dur pour "+me+" : "+shortName(c.n)+" expulsé",shortName(c.n)+" voit rouge, "+me+" fulmine"]));
      (m.inj||[]).filter(x=>x.side===side&&x.d>=2&&BY[x.n]&&BY[x.n].ovr>=85).forEach(x=>add(55,[me+" perd "+shortName(x.n)+" sur blessure","Inquiétude chez "+me+" : "+shortName(x.n)+" blessé"]));
      // Coupe
      if(cupRound){const last=cupRound.name==="Finale";
        if(last&&res>0)add(120,[me+" soulève la coupe !","La coupe est pour "+me,me+" entre dans l'histoire"]);
        else if(last)add(98,[me+" échoue en finale","Si près du but pour "+me]);
        else if(res>0)add(m.pens?88:76,m.pens?[me+" passe aux tirs au but","Nerfs d'acier : "+me+" qualifié aux tirs au but"]:[me+" file au tour suivant",me+" poursuit l'aventure en coupe"]);
        else add(m.pens?93:92,m.pens?["Cruelle élimination aux tirs au but pour "+me]:["Fin de l'aventure en coupe pour "+me,me+" sorti par "+opp,me+" dit adieu à la coupe"])}
      // Classement et séries (championnat)
      if(stAfter){const pa=pos(stAfter,id),pb=pos(stBefore,id),f=stAfter.find(s=>s.id===id).form;
        if(pa===1&&pb!==1)add(88,[me+" prend la tête !",me+" s'empare du fauteuil de leader","Nouveau leader : "+me]);
        if(pb===1&&pa!==1)add(66,[me+" perd sa place de leader","Fin du règne pour "+me]);
        const tail=(arr,v)=>{let k=0;for(let i=arr.length-1;i>=0&&arr[i]===v;i--)k++;return k};
        const w=tail(f,"V"),l=tail(f,"D");let nw=0;for(let i=f.length-1;i>=0&&f[i]!=="V";i--)nw++;
        if(w>=3)add(60+w*2,[me+" ne s'arrête plus ("+w+" victoires de suite)",me+" enchaîne une "+w+"e victoire","Série en cours : "+w+" sur "+w+" pour "+me]);
        if(l>=3)add(62+l*2,["La crise s'installe chez "+me,me+" s'enfonce ("+l+" défaites de suite)"]);
        else if(nw>=4)add(58,[me+" cale encore ("+nw+" matchs sans victoire)","Le doute s'installe chez "+me]);
        if(pa>pb+1)add(45,[me+" chute au classement ("+pa+"e)"]);}
      // Par défaut
      if(res>0)add(m.as===0&&home||m.hs===0&&!home?32:25,[me+" s'impose face à "+opp,"Victoire précieuse pour "+me,me+" fait le travail"]);
      else if(res<0)add(22,[me+" chute face à "+opp,"Revers pour "+me,"Jour sans pour "+me]);
      else add(15,[me+" accroché par "+opp,"Match nul pour "+me]);
    });
    if(!ev.length)return "";
    ev.sort((a,b)=>b.p-a.p);return ev[0].t;
  }
  function block(title,ms,key,cupRound){
    const L=["*<{{APP}}|"+title+">*"];
    try{const hl=headline(ms,key,cupRound);if(hl)L[0]+=" : _« "+hl+" »_"}catch(e){}const done=new Set();let n=0;
    league.mine.forEach(mm=>{const m=ms.find(x=>x.hId===mm.id||x.aId===mm.id);if(!m||done.has(m))return;done.add(m);
      n++;L.push("• "+teamLine(m,mm.id));
      // Rouges et blessures de nos équipes, sur une ligne en dessous
      const sides=[m.hId,m.aId].map((id,i)=>[id,i?"a":"h"]).filter(([id])=>mineIds.has(id));
      sides.forEach(([id,s])=>{const ev=[];
        (m.cards||[]).filter(c=>c.side===s&&c.t!=="Y").forEach(c=>ev.push("🟥 "+c.n+(c.d?" ("+c.d+" match"+(c.d>1?"s":"")+" de suspension)":"")));
        (m.inj||[]).filter(x=>x.side===s).forEach(x=>ev.push("🚑 "+x.n+" (blessé "+x.d+" match"+(x.d>1?"s":"")+")"));
        if(ev.length)L.push((sides.length>1?first(nm(id))+" : ":"")+ev.join(" · "))})});
    return n?L.join("\n"):"";
  }
  // « → Prochain match : J11 à 9h » / « Demi-finales à 21h » : le prochain rendez-vous qui concerne l'un de vous deux
  function stillInCup(asOf){if(!league.cup)return false;const C=league.cup;
    return league.mine.some(mm=>C.rounds.every((R,i)=>{const res=C.results[i];if(!res||cupDate(R.day).getTime()>asOf)return true;const m=res.find(x=>x.hId===mm.id||x.aId===mm.id);
      if(!m)return !(R.ties||[]).length||i===0;return cupWinnerId(m)===mm.id}))}
  function nextLine(afterTime){
    const ev=[];
    league.schedule.forEach((_,k)=>{const t=roundDate(k).getTime();if(t>afterTime)ev.push({t,lab:"J"+(k+1)+" à "+slotHour(k)+"h"})});
    if(league.cup&&stillInCup(afterTime))league.cup.rounds.forEach((R,i)=>{const t=cupDate(R.day).getTime();if(t>afterTime)ev.push({t,lab:R.name+" à "+CUP_HOUR+"h"})});
    if(!ev.length)return "";ev.sort((a,b)=>a.t-b.t);
    return "→ Prochain match : "+ev[0].lab;
  }
  function results(D){
    const lr=league.results[D];if(!lr)return "";
    const txt=block("Journée "+(D+1)+" à "+slotHour(D)+"h",lr,D,null),nx=nextLine(roundDate(D).getTime());
    return txt&&nx?txt+"\n\n"+nx:txt;
  }
  function cupResults(i){
    const R=league.cup.rounds[i],res=league.cup.results[i];if(!res)return "";
    const txt=block(R.name+" à "+CUP_HOUR+"h",res,"c"+i,R),nx=nextLine(cupDate(R.day).getTime());
    return txt&&nx?txt+"\n\n"+nx:txt;
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
      const warn=xi.filter(n=>!statusOf(n,k)&&yellowThreat(n,k));
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
