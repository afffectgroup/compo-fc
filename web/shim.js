// Remplace l'API claude.ai (base de données, utilisateur, téléchargements) par l'API du serveur.
(function () {
  // Qui est connecté (Julien, Yoan…) : chacun ne modifie que son équipe.
  // ME est normalement inscrit dans la page par le serveur ; sinon on le demande (ancienne version en cache)
  if (window.ME === undefined) { try { const x = new XMLHttpRequest(); x.open("GET", "/api/me", false); x.send(); if (x.status === 200) window.ME = JSON.parse(x.responseText).user; } catch (e) {} }
  // Thème : suit le système par défaut, modifiable (Auto / Clair / Sombre) à côté du profil, mémorisé sur l'appareil.
  const TKEY = "compo-fc-theme-" + (window.ME || "x");
  const mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  const getPref = () => { try { return localStorage.getItem(TKEY) || "auto"; } catch (e) { return "auto"; } };
  function applyTheme() {
    const pref = getPref();
    const theme = pref === "auto" ? (mq && !mq.matches ? "light" : "dark") : pref;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePref = pref;
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = theme === "light" ? "#f2f5f1" : "#0c1410";
    const sb = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'); if (sb) sb.content = theme === "light" ? "default" : "black-translucent";
    document.dispatchEvent(new CustomEvent("themechange", { detail: { pref, theme } }));
  }
  window.setThemePref = pref => { try { localStorage.setItem(TKEY, pref); } catch (e) {} applyTheme(); };
  window.getThemePref = getPref;
  if (mq) (mq.addEventListener ? mq.addEventListener("change", applyTheme) : mq.addListener(applyTheme));
  applyTheme();
  document.addEventListener("DOMContentLoaded", applyTheme);
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
    // Mise à jour de l'app détectée : rechargement automatique dès que rien n'est en cours (pas de carte en main, pas de fenêtre ouverte)
    navigator.serviceWorker.addEventListener("message", ev => {
      if (!ev.data || ev.data.type !== "app-updated") return;
      const tryReload = () => {
        const busy = (typeof drag !== "undefined" && drag) || document.querySelector(".overlay:not([hidden])");
        if (busy) return setTimeout(tryReload, 2000);
        location.reload();
      };
      tryReload();
    });
  }
  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: "same-origin" }, opts || {}));
    if (r.status === 401) { location.href = "/login"; throw new Error("auth"); }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  const db = {
    collection() {
      return {
        async get() {
          const j = await api("/api/docs");
          return { docs: j.docs.map(d => ({ id: d.id, data: () => d.data })) };
        },
        doc(id) {
          return {
            async set(data) {
              return await api("/api/docs/" + encodeURIComponent(id), {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(data),
              });
            },
          };
        },
      };
    },
  };
  const user = { async id() { return "shared"; } };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return { status: "saved" };
    },
  };
  window.claude = {
    async use(name) {
      if (name === "db") return db;
      if (name === "user") return user;
      if (name === "downloads") return downloads;
      return null;
    },
  };
})();
