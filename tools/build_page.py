"""Transforme la page de l'artefact (compo/index.html) en page hébergée (web/index.html).

Usage : python3 tools/build_page.py <chemin vers la page de l'artefact>
Les patchs sont idempotents sur une page d'artefact fraîche.
"""
import sys, pathlib

src = pathlib.Path(sys.argv[1]).read_text(encoding="utf8")
h = src

def r(a, b):
    global h
    if h.count(a) != 1:
        raise SystemExit(f"patch introuvable ({h.count(a)}x): {a[:80]!r}")
    h = h.replace(a, b)

# 1. La simulation est faite par le serveur : la page n'avance plus le calendrier elle-même.
r("for(let D=0;D<=maxDay;D++){const d=roundDate(D),ev=d;if(now<ev)break;",
  "for(let D=0;D<=maxDay;D++){const d=roundDate(D),ev=d;if(now<ev||window.SERVER_SIM)break;")

# 2. Horodatage par équipe pour fusionner les modifs de plusieurs personnes.
r("function save(){let ok=true;",
  "function save(){if(typeof state!==\"undefined\"&&state)state.ts=Date.now();let ok=true;")
r("await cloud.col.doc(\"book\").set({teams:book.teams,cur:book.cur,updated:Date.now()})",
  "await cloud.col.doc(\"book\").set({teams:book.teams,cur:book.cur,deleted:book.deleted||[],updated:Date.now()})")

# 3. Suppression d'équipe propagée au serveur ; duplication avec un nouvel identifiant.
r("if(b.dataset.armed){const name=state.name;book.teams.splice(book.cur,1);",
  "if(b.dataset.armed){const name=state.name;(book.deleted=book.deleted||[]).push(state.id);book.teams.splice(book.cur,1);")
r("const c=structuredClone(state);c.name=state.name+\" (copie)\";",
  "const c=structuredClone(state);c.id=\"t\"+Math.random().toString(36).slice(2,10);c.name=state.name+\" (copie)\";")

# 4. Rafraîchissement régulier depuis le serveur (résultats joués par le serveur, équipe de l'autre joueur).
r("setInterval(()=>{if(document.visibilityState===\"visible\")runLeague()},60000);",
  """setInterval(async()=>{if(document.visibilityState!=="visible")return;
  if(cloud&&!pushTimer&&!target){try{const r=await pullCloud();if(r&&Array.isArray(r.teams)&&r.teams.length){const cur=state&&state.id;book={teams:r.teams,cur:Math.max(0,r.teams.findIndex(t=>t.id===cur)),deleted:[]};state=book.teams[book.cur];render()}}catch(e){}}
  runLeague()},30000);""")
r("const uid=await user.id();", "const uid=await user.id();book.deleted=[];")

# 4a. fixBook ne doit pas perdre le propriétaire ni l'horodatage des équipes.
r("resv:Array.isArray(t.resv)?t.resv.filter(n=>typeof n===\"string\"):null,",
  "resv:Array.isArray(t.resv)?t.resv.filter(n=>typeof n===\"string\"):null,owner:typeof t.owner===\"string\"?t.owner:undefined,ts:+t.ts||0,")

# 4b. Chaque frère ne modifie que son équipe (window.ME vient du serveur via shim.js).
r("function save(){if(typeof state!==\"undefined\"&&state)state.ts=Date.now();",
  "function RO(){return viewAI!=null||!!(window.ME&&window.ME!==\"admin\"&&state&&state.owner&&state.owner!==window.ME)}\nfunction save(){if(typeof state!==\"undefined\"&&state){if(!state.owner&&window.ME&&window.ME!==\"admin\")state.owner=window.ME;if(!RO())state.ts=Date.now()}")
for a in ['document.getElementById("teamName").readOnly=viewAI!=null', 'document.getElementById("formation").disabled=viewAI!=null',
          'ts.disabled=viewAI!=null', 'document.body.classList.toggle("view-ai",viewAI!=null)',
          'document.getElementById("delTeam").hidden=viewAI!=null', 'document.getElementById("delTeam").disabled=book.teams.length<2||viewAI!=null',
          'document.getElementById("tactic").onchange=e=>{if(viewAI!=null)return;', 'b.onclick=()=>{if(viewAI!=null)return;spOpen']:
    r(a, a.replace("viewAI!=null", "RO()"))
r('document.addEventListener("pointerdown",e=>{\n  if(viewAI!=null)return;', 'document.addEventListener("pointerdown",e=>{\n  if(RO())return;')
r('if(viewAI!=null){toast("Équipe IA : lecture seule");return}', 'if(RO()){toast(viewAI!=null?"Équipe IA : lecture seule":`Équipe de ${state.owner} : lecture seule`);return}')
r('const ab=document.getElementById("aiBanner");if(ab){ab.hidden=viewAI==null;if(viewAI!=null)document.getElementById("aiBannerName").textContent=state.name}',
  'const ab=document.getElementById("aiBanner");if(ab){ab.hidden=!RO();if(RO()){document.getElementById("aiBannerName").textContent=state.name;const s=ab.querySelector("span");if(s&&s.lastChild)s.lastChild.textContent=viewAI!=null?" · équipe IA, lecture seule":` · équipe de ${state.owner}, lecture seule`;const a=ab.querySelector("a");if(a)a.hidden=viewAI==null}}')

# 5. Squelette HTML complet + shim de l'API.
head = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0c1410">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Compo FC">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>[hidden]{display:none!important}body{margin:0}</style>
<script>window.SERVER_SIM=true</script>
<script src="/shim.js"></script>
"""
h = head + h.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "", 1)
r("<title>Compo FC 27</title>", "<title>Compo FC</title>\n</head>\n<body>")
h = h.rstrip() + "\n</body>\n</html>\n"

out = pathlib.Path(__file__).resolve().parent.parent / "web" / "index.html"
out.write_text(h, encoding="utf8")
print("écrit", out, len(h), "octets")
