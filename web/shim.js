// Remplace l'API claude.ai (base de données, utilisateur, téléchargements) par l'API du serveur.
(function () {
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
              await api("/api/docs/" + encodeURIComponent(id), {
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
