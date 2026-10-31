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
  function pickV(arr,seed){let x=2166136261;for(const c of seed){x^=c.charCodeAt(0);x=Math.imul(x,16777619)>>>0}x=(x^(x>>>15))>>>0;x=Math.imul(x,2246822507)>>>0;x=(x^(x>>>13))>>>0;return arr[x%arr.length]}
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
    const bd=typeof breakDay==="function"?breakDay():null,wd=t=>new Date(t).toLocaleDateString("fr-FR",{weekday:"long"});
    if(bd&&afterTime<bd.getTime()&&ev[0].t>bd.getTime())
      return "→ Trêve de mi-saison "+wd(bd.getTime())+" : aucun match, tout le monde récupère à 100 % (fatigue et blessures)\n→ Prochain match : "+ev[0].lab.replace(" à "," "+wd(ev[0].t)+" à ");
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
  // ---- Teaser Slack sans spoil : une question tirée de la situation AVANT le match ----
  function teaser(ms,key,cupRound,uptoK,avoid){
    avoid=avoid||new Set();
    const all=league.results,o={};Object.keys(all).forEach(x=>{if(+x<=uptoK)o[x]=all[x]});let st;
    try{league.results=o;st=standings()}finally{league.results=all}
    const D=cupRound?cupRound.day:key;try{refreshAbs()}catch(e){}
    const pos=id=>st.findIndex(s=>s.id===id)+1,row=id=>st.find(s=>s.id===id)||{form:[],pts:0,j:0};
    const tail=(arr,v)=>{let k=0;for(let i=arr.length-1;i>=0&&arr[i]===v;i--)k++;return k};
    const xiOf=id=>{const T=lgTeam(id);return ((T&&T.xi)||[]).filter(n=>n&&BY[n])};
    const ovrOf=id=>{const X=xiOf(id);return X.length?X.reduce((a,n)=>a+BY[n].ovr,0)/X.length:0};
    const past=id=>Object.keys(o).sort((x,y)=>x-y).map(k=>(o[k]||[]).find(m=>m.hId===id||m.aId===id)).filter(Boolean);
    const resOf=(m,id)=>{const h=m.hId===id,a=h?m.hs:m.as,b=h?m.as:m.hs;return a>b?1:a<b?-1:0};
    const Q=[];const q=(p,who,arr,opp)=>{const ok=arr.filter(t=>!avoid.has(t));const A=ok.length?ok:arr;Q.push({p,who,opp,t:pickV(A,league.id+key+who+p)})};
    const ids=league.mine.map(m=>m.id),nL=league.schedule.length,BK=typeof breakK==="function"?breakK():-1;
    const dm=ms.find(m=>mineIds.has(m.hId)&&mineIds.has(m.aId));
    if(dm){const a=first(nm(dm.hId)),b=first(nm(dm.aId)),ra=row(dm.hId),rb=row(dm.aId);
      const L=cupRound?["Derby en coupe : qui de "+a+" ou "+b+" a sorti son frère ?","Un seul Déniel passe : "+a+" ou "+b+" ?","Qui a éliminé l'autre en coupe, "+a+" ou "+b+" ?","Le derby de coupe a parlé : "+a+" ou "+b+" ?"]
        :["Derby chez les Déniel : qui de "+a+" ou "+b+" a pris le dessus ?","Le derby a rendu son verdict : "+a+" ou "+b+" ?","Qui a gagné le droit de chambrer : "+a+" ou "+b+" ?","Qui sera insupportable au prochain repas de famille, "+a+" ou "+b+" ?","Duel fratricide : "+a+" ou "+b+" ?","Qui a la suprématie familiale ce soir, "+a+" ou "+b+" ?","Le derby a-t-il tourné à l'humiliation pour l'un des deux frères ?"];
      if(!cupRound&&ra.j>=2&&Math.abs(ra.pts-rb.pts)<=3)L.push("Derby au sommet de la rivalité ("+ra.pts+" pts contre "+rb.pts+") : qui est passé devant ?");
      q(200,"*",L)}
    else ids.forEach(id=>{const m=ms.find(x=>x.hId===id||x.aId===id);if(!m)return;
      const me=first(nm(id)),home=m.hId===id,oppId=home?m.aId:m.hId,opp=nm(oppId),R=row(id),RO=row(oppId),f=R.form,p=pos(id),po=pos(oppId),n=st.length,j=R.j;
      const gap=ovrOf(oppId)-ovrOf(id);
      if(cupRound){const last=cupRound.name==="Finale",nxt={"Barrages":"en quarts","Quarts de finale":"en demies","Demi-finales":"en finale"}[cupRound.name]||"au tour suivant";
        if(last)q(150,me,[me+" a-t-il soulevé la coupe ?","La coupe est-elle pour "+me+" ?",me+" a-t-il gravé son nom sur le trophée ?","Finale : "+me+" a-t-il tenu ses nerfs ?",me+" est-il le nouveau roi de la coupe ?"]);
        else q(90,me,[me+" a-t-il validé son billet "+nxt+" ?",me+" est-il toujours en vie en coupe ?",me+" a-t-il évité le piège "+opp+" ?","L'aventure en coupe continue-t-elle pour "+me+" ?",me+" s'est-il fait sortir par "+opp+" ?",me+" a-t-il eu besoin des tirs au but ?",me+" rêve-t-il encore de la coupe ?"]);
        if(gap>=2)q(95,me,["Exploit en vue : "+me+" a-t-il sorti "+opp+", plus fort sur le papier ?",me+" a-t-il renversé la hiérarchie face à "+opp+" ?"]);
        return}
      const w=tail(f,"V"),l=tail(f,"D");let nw=0;for(let i=f.length-1;i>=0&&f[i]!=="V";i--)nw++;let nl=0;for(let i=f.length-1;i>=0&&f[i]!=="D";i--)nl++;
      // moments de la saison
      if(j===0)q(120,me,["Premier match de la saison : "+me+" a-t-il bien démarré ?",me+" a-t-il réussi son entrée en matière ?","Les grands débuts de "+me+" : réussis ?"]);
      if(key===BK)q(115,me,["Retour de trêve : "+me+" a-t-il repris du bon pied ?",me+" a-t-il bien digéré la trêve ?","Les batteries rechargées, "+me+" a-t-il cartonné ?"]);
      if(key===nL-1)q(130,me,["Dernière journée : "+me+" a-t-il fini en beauté ?",me+" a-t-il terminé la saison sur une bonne note ?","Ultime match pour "+me+" : la der' de rêve ?"]);
      else if(j>=nL-5&&p<=3)q(100,me,[me+" est-il toujours dans la course au titre ?","Sprint final : "+me+" tient-il le rythme du podium ?",me+" a-t-il gardé le titre en ligne de mire ?"]);
      // séries
      if(f.length>=2&&w===f.length)q(110+w,me,[me+" a-t-il réussi le "+(w+1)+" sur "+(w+1)+" ?",me+" est-il toujours parfait après "+(w+1)+" journées ?","Le sans-faute de "+me+" a-t-il tenu ?","Quelqu'un a-t-il enfin battu "+me+" ?"]);
      else if(w>=2)q(80+w*3,me,[me+" a-t-il enchaîné une "+(w+1)+"e victoire de suite ?","La série de "+me+" a-t-elle tenu face à "+opp+" ?",me+" est-il toujours sur sa lancée ?",opp+" a-t-il freiné "+me+" ?",me+" est-il inarrêtable ("+w+" victoires de suite) ?"]);
      else if(nl>=4)q(74,me,[me+" est-il toujours invaincu ("+nl+" matchs sans défaite) ?","L'invincibilité de "+me+" a-t-elle pris fin ?",me+" a-t-il prolongé sa série sans défaite ?"]);
      if(l>=2)q(85+l*3,me,[me+" a-t-il enfin stoppé l'hémorragie ?",me+" continue-t-il de sombrer au classement ?",me+" a-t-il touché le fond face à "+opp+" ?",me+" a-t-il enfin relevé la tête ?","La crise continue-t-elle pour "+me+" ?",me+" a-t-il mis fin à sa série noire ("+l+" défaites) ?","Faut-il s'inquiéter pour "+me+" ?",me+" a-t-il trouvé la sortie du tunnel ?"]);
      else if(nw>=3)q(78,me,[me+" a-t-il enfin renoué avec la victoire après "+nw+" matchs sans gagner ?","La disette de "+me+" a-t-elle pris fin ?",me+" a-t-il enfin gagné un match ?",me+" a-t-il retrouvé le chemin de la victoire ?","Le déclic est-il enfin venu pour "+me+" ?"]);
      // classement
      if(j>=3&&p===1)q(88,me,[me+" a-t-il conservé son fauteuil de leader ?",me+" est-il toujours en tête ?","Le leader "+me+" a-t-il tremblé ?",me+" a-t-il creusé l'écart en tête ?"]);
      else if(j>=3&&p>1&&st[0].pts-R.pts<=2)q(86,me,[me+" a-t-il pris la tête du championnat ?",me+" s'est-il emparé de la première place ?",me+" est-il le nouveau leader ?","Le fauteuil de leader a-t-il changé de propriétaire au profit de "+me+" ?"]);
      if(j>=3&&p===n)q(70,me,[me+" a-t-il quitté la dernière place ?",me+" est-il toujours lanterne rouge ?",me+" a-t-il laissé la lanterne rouge à un autre ?"]);
      else if(j>=3&&p>=n-2&&!(l>=2))q(60,me,[me+" s'est-il donné de l'air au classement ?",me+" a-t-il évité de plonger vers le fond ?"]);
      // adversaire
      if(j>=3&&po===1)q(76,me,[me+" a-t-il fait tomber le leader "+opp+" ?",me+" a-t-il fait chuter "+opp+", le leader ?","Le leader "+opp+" est-il passé à la trappe face à "+me+" ?"]);
      if(j>=3&&po===n)q(55,me,[me+" a-t-il fait le travail face à la lanterne rouge ?",me+" s'est-il fait piéger par la lanterne rouge ?","Victoire obligatoire pour "+me+" contre la lanterne rouge : mission accomplie ?"]);
      const ow=tail(RO.form,"V");if(ow>=3)q(72,me,[me+" a-t-il stoppé la série de "+opp+" ("+ow+" victoires de suite) ?",opp+" a-t-il enchaîné face à "+me+" ?"]);
      if(gap>=2.5)q(68,me,["David contre Goliath : "+me+" a-t-il fait tomber "+opp+" ?",me+" a-t-il créé l'exploit face à "+opp+" ?",opp+", plus fort sur le papier, a-t-il dominé "+me+" ?"]);
      else if(gap<=-2.5)q(40,me,[me+" a-t-il évité la peau de banane face à "+opp+" ?",me+" a-t-il assumé son statut de favori ?",me+" s'est-il fait surprendre par "+opp+" ?"]);
      // revanche
      const prev=past(id).filter(x=>x.hId===oppId||x.aId===oppId).pop();
      if(prev&&resOf(prev,id)<0)q(82,me,[me+" a-t-il pris sa revanche sur "+opp+" ?","L'heure de la revanche a-t-elle sonné pour "+me+" face à "+opp+" ?",opp+" a-t-il encore fait souffrir "+me+" ?"]);
      else if(prev&&resOf(prev,id)>0)q(45,me,[me+" a-t-il encore battu "+opp+" ?",opp+" a-t-il pris sa revanche sur "+me+" ?"]);
      // effectif : absent de marque, fatigue, buteur en feu
      const X=xiOf(id),best=X.slice().sort((x,y)=>BY[y].ovr-BY[x].ovr);const abs=best.find(nn=>{try{return statusOf(nn,D)}catch(e){return false}});
      if(abs&&BY[abs].ovr>=85){const sn=shortName(abs);q(84,me,["Sans "+sn+", "+me+" s'en est-il sorti ?",me+" a-t-il survécu à l'absence de "+sn+" ?","Privé de "+sn+", "+me+" a-t-il trouvé la solution ?"])}
      try{const tired=X.filter(nn=>conditionOf(nn,D)<80).length;if(tired>=3)q(66,me,["Les jambes de "+me+" ont-elles tenu ?",me+" a-t-il payé la fatigue ?","Avec "+tired+" titulaires dans le rouge, "+me+" a-t-il tenu le choc ?"])}catch(e){}
      const last3=past(id).slice(-3);if(last3.length===3){const sideOf=mm=>mm.hId===id?"h":"a";const sets=last3.map(mm=>new Set((mm.goals||[]).filter(g=>g.side===sideOf(mm)&&!g.og).map(g=>g.n)));
        const hot=[...sets[0]].find(nn=>sets[1].has(nn)&&sets[2].has(nn)&&X.includes(nn));if(hot){const sn=shortName(hot);q(79,me,[sn+" a-t-il encore marqué pour "+me+" ?","La série de "+sn+" (3 matchs avec un but) a-t-elle continué ?",sn+" est-il toujours en feu ?"])}}
      // par défaut
      q(10,me,home?[me+" a-t-il fait respecter son terrain face à "+opp+" ?",me+" a-t-il pris les trois points face à "+opp+" ?","Victoire, nul ou défaite pour "+me+" face à "+opp+" ?",me+" a-t-il tenu son rang face à "+opp+" ?",me+" a-t-il régalé son public face à "+opp+" ?","Combien de buts pour "+me+" face à "+opp+" ?"]
        :[me+" est-il revenu de chez "+opp+" avec des points ?",me+" a-t-il pris les trois points chez "+opp+" ?","Victoire, nul ou défaite pour "+me+" chez "+opp+" ?",me+" a-t-il réussi son déplacement chez "+opp+" ?",me+" a-t-il fait taire le public de "+opp+" ?","Combien de buts pour "+me+" chez "+opp+" ?"],opp+"|"+(home?"h":"a"))});
    // rivalité au classement
    if(!dm&&!cupRound&&ids.length===2){const [x,y]=ids,px=pos(x),py=pos(y),ax=row(x),ay=row(y);
      if(ax.j>=2&&Math.abs(ax.pts-ay.pts)<=3&&px!==py){const behind=first(nm(px>py?x:y)),ahead=first(nm(px>py?y:x));
        q(72,"*",[behind+" a-t-il doublé "+ahead+" au classement ?","Le classement a-t-il changé de mains chez les Déniel ? "+behind+" est-il passé devant "+ahead+" ?",ahead+" est-il toujours devant "+behind+" au classement ?","Bataille familiale au classement : "+behind+" a-t-il grillé la politesse à "+ahead+" ?"])}
      else if(ax.j>=4&&Math.abs(ax.pts-ay.pts)>=9){const lo=first(nm(ax.pts<ay.pts?x:y)),hi=first(nm(ax.pts<ay.pts?y:x));q(50,"*",[lo+" a-t-il grignoté son retard sur "+hi+" ?","L'écart entre "+hi+" et "+lo+" s'est-il encore creusé ?"])}}
    if(!Q.length)return "";
    Q.sort((a,b)=>b.p-a.p);const out=[Q[0]];if(Q[0].who!=="*"){const other=Q.find(x=>x.who!==Q[0].who&&x.who!=="*");if(other)out.push(other)}
    const strip=x=>x.t.split(x.who).join("§");
    if(out.length===2&&strip(out[0])===strip(out[1]))return out[0].t+" Et "+out[1].who+" ?";
    if(out.length===2&&out[1].p===10){const [op,ha]=(out[1].opp||"").split("|");out[1].t=pickV(ha==="h"?["Et "+out[1].who+", face à "+op+" ?","Et "+out[1].who+" à domicile contre "+op+" ?","Pendant ce temps, "+out[1].who+" a-t-il battu "+op+" ?"]:["Et "+out[1].who+", chez "+op+" ?","Et "+out[1].who+" en déplacement chez "+op+" ?","Pendant ce temps, "+out[1].who+" a-t-il gagné chez "+op+" ?"],league.id+key+"x")}
    return out.map(x=>x.t).join(" ");
  }
  // les questions des journées précédentes sont évitées pour ne pas se répéter
  function recent(n,before){const A=new Set();for(let d=before-1;d>=Math.max(0,before-n);d--){const ms=league.results[d];if(!ms)continue;try{teaser(ms,d,null,d-1).split(/(?<=\?)\s+/).forEach(t=>A.add(t))}catch(e){}}return A}
  function teaserL(D){const ms=league.results[D];if(!ms)return "";const t="*<{{APP}}|Journée "+(D+1)+" à "+slotHour(D)+"h>* : c'est terminé !";let tq="";try{tq=teaser(ms,D,null,D-1,recent(4,D))}catch(e){}return t+(tq?"\n_"+tq+"_":"")+"\nRéponse dans l'app."}
  function teaserC(i){const R=league.cup.rounds[i],ms=league.cup.results[i];if(!ms)return "";const t="*<{{APP}}|"+R.name+" à "+CUP_HOUR+"h>* : c'est terminé !";let tq="";try{tq=teaser(ms,"c"+i,R,R.day)}catch(e){}return t+(tq?"\n_"+tq+"_":"")+"\nRéponse dans l'app."}
  return {results,cupResults,reminder,seasonEnd,teaserL,teaserC};
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
    for (const D of playedSlots(league)) if (!posted.has(D)) { const text = R.results(D); if (text) msgs.push({ kind: "results", slot: D, text, teaser: R.teaserL(D) }); posted.add(D); }
    const postedCup = new Set(sameLeague ? (meta.postedCup || []) : []);
    for (const i of playedCup(league)) if (!postedCup.has(i)) { const text = R.cupResults(i); if (text) msgs.push({ kind: "cup", round: i, text, teaser: R.teaserC(i) }); postedCup.add(i); }
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
