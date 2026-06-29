(() => {
  "use strict";

  const players = Array.isArray(globalThis.INAZUMA_PLAYERS) ? globalThis.INAZUMA_PLAYERS : [];
  const teams = Array.isArray(globalThis.INAZUMA_TEAMS) ? globalThis.INAZUMA_TEAMS : [];
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    debug: $("#ratings-debug"),
    teams: $("#ratings-team-list"),
    heading: $("#ratings-player-heading"),
    players: $("#ratings-player-list"),
  };
  const playerById = new Map(players.map((player) => [String(player.id), player]));
  let selectedTeamId = teams[0]?.id || "";

  const clean = (value) => String(value ?? "").trim();
  const key = (value) => clean(value).toLocaleLowerCase();
  const unique = (values) => [...new Set(values.filter(Boolean))];

  function teamLookupValues(team) {
    return unique([team?.id, team?.name, ...(Array.isArray(team?.aliases) ? team.aliases : [])].map(key));
  }

  function candidateValues(value) {
    if (Array.isArray(value)) return value.flatMap(candidateValues);
    if (value && typeof value === "object") return [value.id, value.name, value.teamId, value.team].map(key);
    return [key(value)];
  }

  function linkedByTeamPlayers(team) {
    return (Array.isArray(team?.players) ? team.players : []).map((entry) => {
      if (entry && typeof entry === "object") return playerById.get(String(entry.id)) || entry;
      return playerById.get(String(entry));
    }).filter((player) => player && player.name);
  }

  function linkedByPlayerFields(team) {
    const teamValues = new Set(teamLookupValues(team));
    return players.filter((player) => {
      const values = [player.teamId, player.team, player.teams].flatMap(candidateValues);
      return values.some((value) => teamValues.has(value));
    });
  }

  function playersForTeam(team) {
    if (Array.isArray(team?.playerIds)) {
      return team.playerIds.map((id) => playerById.get(String(id))).filter(Boolean).sort((a, b) => collator.compare(a.name, b.name));
    }
    const fromTeamPlayers = linkedByTeamPlayers(team);
    const linked = fromTeamPlayers.length ? fromTeamPlayers : linkedByPlayerFields(team);
    return unique(linked.map((player) => player.id)).map((id) => linked.find((player) => player.id === id)).filter(Boolean).sort((a, b) => collator.compare(a.name, b.name));
  }

  function fallbackText(value) {
    return clean(value).slice(0, 2).toUpperCase() || "?";
  }

  function imageOrPlaceholder(url, alt, placeholderText, className) {
    const box = document.createElement("span"); box.className = className;
    if (!url) { box.textContent = fallbackText(placeholderText); return box; }
    const image = document.createElement("img"); image.src = url; image.alt = alt; image.loading = "lazy"; image.decoding = "async";
    image.addEventListener("error", () => { image.remove(); box.textContent = fallbackText(placeholderText); }, { once: true });
    box.append(image); return box;
  }

  function renderDebug() {
    nodes.debug.replaceChildren(
      stat("Giocatori caricati", players.length.toLocaleString()),
      stat("Squadre caricate", teams.length.toLocaleString()),
      stat("Fonte dati giocatori", "globalThis.INAZUMA_PLAYERS"),
      stat("Fonte dati squadre", "globalThis.INAZUMA_TEAMS"),
    );
  }

  function stat(label, value) {
    const item = document.createElement("div"); item.className = "ratings-debug__item";
    const title = document.createElement("strong"); title.textContent = label;
    const text = document.createElement("span"); text.textContent = value;
    item.append(title, text); return item;
  }

  function teamCard(team) {
    const roster = playersForTeam(team);
    const button = document.createElement("button"); button.type = "button"; button.className = "ratings-team-card";
    button.classList.toggle("is-selected", team.id === selectedTeamId);
    button.append(imageOrPlaceholder(team.logoUrl, `${team.name} logo`, team.name, "team-logo team-logo--card"));
    const text = document.createElement("span"); text.className = "ratings-team-card__text";
    const name = document.createElement("strong"); name.textContent = team.name || team.id || "Unnamed team";
    const id = document.createElement("small"); id.textContent = `ID: ${team.id || "—"}`;
    const count = document.createElement("small"); count.textContent = `${roster.length} giocatori collegati`;
    text.append(name, id, count); button.append(text);
    button.addEventListener("click", () => { selectedTeamId = team.id; render(); });
    return button;
  }

  function playerRow(player) {
    const row = document.createElement("article"); row.className = "ratings-player-row";
    row.append(imageOrPlaceholder(player.imageUrl || player.portraitUrl, `${player.name} portrait`, player.name, "ratings-player-row__portrait"));
    const text = document.createElement("span");
    const name = document.createElement("strong"); name.textContent = player.name || "Unnamed player";
    const meta = document.createElement("small"); meta.textContent = `${player.position || player.role || "Ruolo sconosciuto"} · ID: ${player.id ?? "—"}`;
    text.append(name, meta); row.append(text); return row;
  }

  function emptyTeamMessage(team) {
    const box = document.createElement("div"); box.className = "ratings-empty";
    const message = document.createElement("p"); message.textContent = "Nessun giocatore collegato a questa squadra";
    const fields = document.createElement("small"); fields.textContent = `Campi squadra disponibili: ${Object.keys(team || {}).join(", ") || "nessuno"}`;
    box.append(message, fields); return box;
  }

  function renderPlayers(team) {
    const roster = playersForTeam(team);
    nodes.heading.textContent = team ? `Giocatori: ${team.name || team.id}` : "Giocatori squadra";
    if (!team) { nodes.players.replaceChildren(Object.assign(document.createElement("p"), { className: "ratings-empty", textContent: "Nessuna squadra disponibile." })); return; }
    if (!roster.length) { nodes.players.replaceChildren(emptyTeamMessage(team)); return; }
    const fragment = document.createDocumentFragment(); roster.forEach((player) => fragment.append(playerRow(player))); nodes.players.replaceChildren(fragment);
  }

  function render() {
    if (!nodes.debug || !nodes.teams || !nodes.players) return;
    renderDebug();
    const fragment = document.createDocumentFragment(); teams.forEach((team) => fragment.append(teamCard(team))); nodes.teams.replaceChildren(fragment);
    renderPlayers(teams.find((team) => team.id === selectedTeamId) || teams[0]);
  }

  globalThis.InazumaPlayerRatings = { render, playersForTeam };
})();
