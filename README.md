# Compo FC

Compos d'équipe, championnat simulé (10 équipes, coupe) et résultats postés sur Slack.

- Les matchs se jouent **tous les jours à 9h et 14h** (heure de Paris), côté serveur, même si personne n'ouvre l'app.
- Slack reçoit les **résultats** après chaque journée, un **rappel 30 min avant** chaque match (absents, fatigués, menacés de suspension) et le **bilan de fin de saison**.
- Toutes les personnes qui ont le code d'accès voient et modifient le même championnat.

## Déploiement sur Railway

1. **New Project → Deploy from GitHub repo** → `afffectgroup/compo-fc`.
2. Dans le service, onglet **Variables** :
   | Variable | Valeur |
   |---|---|
   | `ACCESS_KEY` | le code d'accès à l'app (à choisir) |
   | `SLACK_WEBHOOK_URL` | l'URL « Incoming Webhook » du canal Slack |
   | `DATA_DIR` | `/data` |
   | `TZ` | `Europe/Paris` |
3. **Volume** : clic droit sur le service → *Attach volume* → point de montage `/data` (sinon l'état est perdu à chaque déploiement).
4. **Settings → Networking → Generate Domain** pour obtenir l'adresse publique.
5. Tester Slack : `curl -X POST https://<domaine>/api/test-slack -H "cookie: k=<ACCESS_KEY>"`.

Au premier démarrage, l'état est repris depuis `seed/state.json` (la saison en cours au moment de la migration).

## Créer le webhook Slack

api.slack.com/apps → *Create New App* → *From scratch* → **Incoming Webhooks** → activer → *Add New Webhook to Workspace* → choisir le canal → copier l'URL.

## Structure

- `web/index.html` : l'app (générée depuis la page d'origine par `tools/build_page.py`).
- `web/shim.js` : branche l'app sur l'API du serveur.
- `engine.js` : exécute le moteur de l'app côté serveur (jsdom) et rédige les messages Slack.
- `server.js` : serveur HTTP, stockage JSON (`DATA_DIR/state.json`), fusion des modifications, boucle de jeu.

## Variables optionnelles

- `REMINDER_MINUTES` (30 par défaut) : délai du rappel avant chaque match.
- `APP_URL` : lien ajouté sous chaque message Slack (déduit automatiquement sur Railway).
