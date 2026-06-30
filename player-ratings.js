(() => {
  "use strict";

  const players = Array.isArray(globalThis.INAZUMA_PLAYERS) ? globalThis.INAZUMA_PLAYERS : [];
  const teams = Array.isArray(globalThis.INAZUMA_TEAMS) ? globalThis.INAZUMA_TEAMS : [];
  const STORAGE_KEY = "inazumaPlayerRatings";
  const STAT_DEFS = [
    ["attack", "Attacco"], ["physical", "Fisico"], ["stamina", "Resistenza"], ["control", "Controllo"],
    ["defense", "Difesa"], ["speed", "Velocità"], ["grit", "Grinta"], ["save", "Parata"],
  ];
  const DEFAULT_STATS = Object.fromEntries(STAT_DEFS.map(([key]) => [key, 5]));
  const WEIGHTS = {
    FW: { attack: 32, control: 20, speed: 15, grit: 10, physical: 10, stamina: 8, defense: 5, save: 0 },
    MF: { control: 24, stamina: 18, grit: 16, speed: 13, attack: 12, defense: 12, physical: 5, save: 0 },
    DF: { defense: 32, physical: 18, grit: 15, stamina: 13, speed: 10, control: 7, attack: 5, save: 0 },
    GK: { save: 50, grit: 15, physical: 12, defense: 8, control: 5, stamina: 5, speed: 3, attack: 2 },
  };
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    debug: $("#ratings-debug"), progress: $("#ratings-progress"), teams: $("#ratings-team-list"), selectedTeam: $("#ratings-selected-team"), heading: $("#ratings-player-heading"), players: $("#ratings-player-list"), editor: $("#ratings-editor"),
    search: $("#ratings-player-search"), status: $("#ratings-status-filter"), toggleTeams: $("#ratings-toggle-teams"), exportRatings: $("#export-ratings"), exportTeams: $("#export-rated-teams"),
    exportTeamList: $("#ratings-export-team-list"), exportSelectAll: $("#ratings-export-select-all"), exportClear: $("#ratings-export-clear"), exportRatedOnly: $("#ratings-export-rated-only"), exportSelectedTeams: $("#export-selected-team-ratings"), exportFeedback: $("#ratings-export-feedback"),
  };
  const playerById = new Map(players.map((player) => [String(player.id), player]));
  let selectedTeamId = teams[0]?.id || "";
  let selectedPlayerId = "";
  let playerSearch = "";
  let statusFilter = "all";
  let ratings = loadRatings();
  let completionMessage = "";
  let teamsCollapsed = false;
  const selectedExportTeamIds = new Set();

  const clean = (value) => String(value ?? "").trim();
  const key = (value) => clean(value).toLocaleLowerCase();
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const clampStat = (value) => Math.max(1, Math.min(10, Number(value) || 5));
  const playerId = (player) => String(player?.id ?? "");

  function loadRatings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function persistRatings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
  }

  function normalizeRating(record = {}) {
    const stats = { ...DEFAULT_STATS };
    STAT_DEFS.forEach(([stat]) => { stats[stat] = clampStat(record[stat]); });
    return { ...stats, updatedAt: clean(record.updatedAt) || new Date().toISOString() };
  }

  function draftRating(player) {
    const saved = ratings[playerId(player)];
    return saved ? normalizeRating(saved) : { ...DEFAULT_STATS, updatedAt: "" };
  }

  function isRated(player) {
    return Boolean(ratings[playerId(player)]?.updatedAt);
  }

  function roleCode(player) {
    const value = key(`${player?.position || ""} ${player?.role || ""}`);
    if (value.includes("gk") || value.includes("por")) return "GK";
    if (value.includes("df") || value.includes("def")) return "DF";
    if (value.includes("fw") || value.includes("att")) return "FW";
    return "MF";
  }

  function overallFor(player, rating) {
    const weights = WEIGHTS[roleCode(player)] || WEIGHTS.MF;
    const roleScore = STAT_DEFS.reduce((sum, [stat]) => sum + (clampStat(rating[stat]) * (weights[stat] || 0) / 100), 0);
    return Math.max(1, Math.min(99, Math.round(30 + ((roleScore - 1) * 69 / 9))));
  }

  function categoryFor(overall) {
    if (overall >= 95) return "Leggenda";
    if (overall >= 90) return "Mondiale";
    if (overall >= 85) return "Elite";
    if (overall >= 80) return "Forte";
    if (overall >= 75) return "Buono";
    if (overall >= 70) return "Normale";
    if (overall >= 60) return "Debole";
    return "Scarso";
  }

  function starsFor(overall) {
    if (overall === null) return null;
    if (overall >= 90) return 5;
    if (overall >= 82) return 4.5;
    if (overall >= 75) return 4;
    if (overall >= 68) return 3.5;
    if (overall >= 60) return 3;
    if (overall >= 52) return 2.5;
    if (overall >= 45) return 2;
    if (overall >= 35) return 1.5;
    return 1;
  }

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
    return players.filter((player) => [player.teamId, player.team, player.teams].flatMap(candidateValues).some((value) => teamValues.has(value)));
  }

  function playersForTeam(team) {
    if (Array.isArray(team?.playerIds)) return team.playerIds.map((id) => playerById.get(String(id))).filter(Boolean).sort((a, b) => collator.compare(a.name, b.name));
    const linked = linkedByTeamPlayers(team); const fallback = linked.length ? linked : linkedByPlayerFields(team);
    return unique(fallback.map((player) => player.id)).map((id) => fallback.find((player) => player.id === id)).filter(Boolean).sort((a, b) => collator.compare(a.name, b.name));
  }

  function selectedTeam() {
    return teams.find((team) => team.id === selectedTeamId) || teams[0];
  }

  function selectedRoster() {
    return playersForTeam(selectedTeam());
  }

  function filteredRoster() {
    const needle = playerSearch.toLocaleLowerCase();
    return selectedRoster().filter((player) => (!needle || key(player.name).includes(needle)) && (statusFilter === "all" || (statusFilter === "rated" ? isRated(player) : !isRated(player))));
  }

  function teamSummary(team) {
    const roster = playersForTeam(team);
    const overalls = roster.filter(isRated).map((player) => overallFor(player, ratings[playerId(player)]));
    const teamOverall = overalls.length ? Math.round(overalls.reduce((sum, value) => sum + value, 0) / overalls.length) : null;
    return { roster, ratedPlayers: overalls.length, totalPlayers: roster.length, teamOverall, teamStars: starsFor(teamOverall) };
  }

  function fallbackText(value) { return clean(value).slice(0, 2).toUpperCase() || "?"; }

  function imageOrPlaceholder(url, alt, placeholderText, className) {
    const box = document.createElement("span"); box.className = className;
    if (!url) { box.textContent = fallbackText(placeholderText); return box; }
    const image = document.createElement("img"); image.src = url; image.alt = alt; image.loading = "lazy"; image.decoding = "async";
    image.addEventListener("error", () => { image.remove(); box.textContent = fallbackText(placeholderText); }, { once: true });
    box.append(image); return box;
  }

  function stat(label, value) {
    const item = document.createElement("div"); item.className = "ratings-debug__item";
    const title = document.createElement("strong"); title.textContent = label;
    const text = document.createElement("span"); text.textContent = value;
    item.append(title, text); return item;
  }

  function renderDebug() {
    const team = selectedTeam();
    nodes.debug.replaceChildren(
      stat("Giocatori caricati", players.length.toLocaleString()), stat("Squadre caricate", teams.length.toLocaleString()),
      stat("Fonte dati giocatori", "globalThis.INAZUMA_PLAYERS"), stat("Fonte dati squadre", "globalThis.INAZUMA_TEAMS"),
      stat("Valutazioni salvate in localStorage", Object.keys(ratings).length.toLocaleString()),
      stat("Squadra selezionata", team ? `${team.name || "—"} / ${team.id || "—"}` : "—"),
      stat("Giocatori collegati alla squadra selezionata", team ? playersForTeam(team).length.toLocaleString() : "0"),
    );
  }

  function renderProgress() {
    const ratedCount = players.filter(isRated).length;
    const percent = players.length ? Math.round((ratedCount / players.length) * 100) : 0;
    nodes.progress.textContent = `Progresso globale: ${ratedCount} giocatori valutati / ${players.length} (${percent}%)`;
  }

  function renderTeams() {
    const fragment = document.createDocumentFragment();
    teams.forEach((team) => {
      const summary = teamSummary(team);
      const button = document.createElement("button"); button.type = "button"; button.className = "ratings-team-card"; button.classList.toggle("is-selected", team.id === selectedTeamId);
      button.append(imageOrPlaceholder(team.logoUrl, `${team.name} logo`, team.name, "team-logo team-logo--card"));
      const text = document.createElement("span"); text.className = "ratings-team-card__text";
      const name = document.createElement("strong"); name.textContent = team.name || team.id || "Unnamed team";
      const id = document.createElement("small"); id.className = "ratings-team-id"; id.textContent = `ID: ${team.id || "—"}`;
      const progress = document.createElement("small"); progress.textContent = `${summary.ratedPlayers}/${summary.totalPlayers}`;
      const overall = document.createElement("small"); overall.textContent = summary.teamOverall === null ? "OVR -- · ★ --" : `OVR ${summary.teamOverall} · ★ ${summary.teamStars}`;
      text.append(name, id, progress, overall); button.append(text);
      button.addEventListener("click", () => { selectedTeamId = team.id; selectedPlayerId = ""; completionMessage = ""; teamsCollapsed = true; render(); });
      fragment.append(button);
    });
    nodes.teams.replaceChildren(fragment);
  }

  function ratingBadge(player) {
    const badge = document.createElement("span"); badge.className = `ratings-badge ${isRated(player) ? "ratings-badge--rated" : ""}`;
    badge.textContent = isRated(player) ? "Valutato" : "Non valutato"; return badge;
  }

  function playerRow(player) {
    const rated = isRated(player); const rating = draftRating(player); const overall = overallFor(player, rating); const category = categoryFor(overall);
    const row = document.createElement("button"); row.type = "button"; row.className = "ratings-player-row"; row.classList.toggle("is-selected", playerId(player) === selectedPlayerId);
    row.append(imageOrPlaceholder(player.imageUrl || player.portraitUrl, `${player.name} portrait`, player.name, "ratings-player-row__portrait"));
    const text = document.createElement("span"); const name = document.createElement("strong"); name.textContent = player.name || "Unnamed player";
    const meta = document.createElement("small"); meta.textContent = `${player.position || player.role || "Ruolo sconosciuto"} · ID: ${player.id ?? "—"}`;
    const score = document.createElement("small"); score.textContent = rated ? `Overall ${overall} · ${category}` : "Overall -- · Non valutato";
    text.append(name, meta, score); row.append(text, ratingBadge(player)); row.addEventListener("click", () => openPlayer(player)); return row;
  }

  function emptyTeamMessage(team) {
    const box = document.createElement("div"); box.className = "ratings-empty";
    const message = document.createElement("p"); message.textContent = "Nessun giocatore collegato a questa squadra";
    const fields = document.createElement("small"); fields.textContent = `Campi squadra disponibili: ${Object.keys(team || {}).join(", ") || "nessuno"}`;
    box.append(message, fields); return box;
  }

  function renderSelectedTeamBar() {
    const team = selectedTeam();
    if (!team || !nodes.selectedTeam) return;
    const summary = teamSummary(team);
    nodes.selectedTeam.replaceChildren(
      imageOrPlaceholder(team.logoUrl, `${team.name} logo`, team.name, "team-logo team-logo--card"),
      Object.assign(document.createElement("strong"), { textContent: team.name || team.id || "Squadra" }),
      Object.assign(document.createElement("span"), { textContent: `${summary.ratedPlayers}/${summary.totalPlayers} valutati` }),
      Object.assign(document.createElement("span"), { textContent: summary.teamOverall === null ? "OVR --" : `OVR ${summary.teamOverall}` }),
      Object.assign(document.createElement("span"), { textContent: summary.teamStars === null ? "★ --" : `★ ${summary.teamStars}` }),
    );
  }

  function renderPlayers() {
    const team = selectedTeam(); const roster = filteredRoster(); const fullRoster = selectedRoster();
    nodes.heading.textContent = team ? `Giocatori: ${team.name || team.id}` : "Giocatori squadra";
    if (!team) { nodes.players.replaceChildren(Object.assign(document.createElement("p"), { className: "ratings-empty", textContent: "Nessuna squadra disponibile." })); return; }
    if (!fullRoster.length) { nodes.players.replaceChildren(emptyTeamMessage(team)); return; }
    const fragment = document.createDocumentFragment(); roster.forEach((player) => fragment.append(playerRow(player)));
    if (!roster.length) fragment.append(Object.assign(document.createElement("p"), { className: "ratings-empty", textContent: "Nessun giocatore corrisponde ai filtri." }));
    nodes.players.replaceChildren(fragment);
  }

  function saveRating(player, rating) {
    ratings[playerId(player)] = { ...normalizeRating(rating), updatedAt: new Date().toISOString() };
    persistRatings();
  }

  function openPlayer(player) {
    selectedPlayerId = playerId(player); completionMessage = ""; renderEditor(player); renderPlayers(); renderDebug(); renderProgress(); renderTeams();
  }

  function renderEditor(player = playerById.get(selectedPlayerId)) {
    if (!player) { nodes.editor.hidden = true; nodes.editor.replaceChildren(); return; }
    const team = selectedTeam(); const rating = draftRating(player); const overall = overallFor(player, rating); const category = categoryFor(overall); const rated = isRated(player);
    nodes.editor.hidden = false;
    const card = document.createElement("article"); card.className = "ratings-editor-card";
    const header = document.createElement("header");
    header.append(imageOrPlaceholder(player.imageUrl || player.portraitUrl, `${player.name} portrait`, player.name, "ratings-editor-card__portrait"));
    const info = document.createElement("div"); const name = document.createElement("h3"); name.textContent = player.name || "Unnamed player";
    const meta = document.createElement("p"); meta.textContent = `ID: ${player.id ?? "—"} · ${player.position || player.role || "Ruolo sconosciuto"} · ${team?.name || "—"}`;
    const score = document.createElement("p"); score.className = "ratings-editor-card__score"; score.textContent = `Overall ${overall} · ${category} · ${rated ? "Valutato" : "Non valutato"}`;
    info.append(name, meta, score); header.append(info); card.append(header);
    const controls = document.createElement("div"); controls.className = "ratings-stat-grid";
    STAT_DEFS.forEach(([stat, label]) => {
      const row = document.createElement("div"); row.className = "ratings-stat-control";
      const title = document.createElement("strong"); title.textContent = label;
      const minus = document.createElement("button"); minus.type = "button"; minus.textContent = "-";
      const value = document.createElement("span"); value.textContent = rating[stat];
      const plus = document.createElement("button"); plus.type = "button"; plus.textContent = "+";
      const change = (delta) => { rating[stat] = clampStat(rating[stat] + delta); saveRating(player, rating); render(); renderEditor(player); };
      minus.addEventListener("click", () => change(-1)); plus.addEventListener("click", () => change(1));
      row.append(title, minus, value, plus); controls.append(row);
    });
    const actions = document.createElement("div"); actions.className = "ratings-editor-actions";
    const next = document.createElement("button"); next.type = "button"; next.className = "button ratings-save-next"; next.textContent = "SALVA E PROSSIMO"; next.addEventListener("click", () => saveAndNext(player));
    const back = document.createElement("button"); back.type = "button"; back.className = "button button--quiet"; back.textContent = "Torna alla squadra"; back.addEventListener("click", () => { selectedPlayerId = ""; completionMessage = ""; render(); });
    actions.append(next, back); card.append(controls, actions);
    if (completionMessage) card.append(Object.assign(document.createElement("p"), { className: "ratings-complete", textContent: completionMessage }));
    nodes.editor.replaceChildren(card);
  }

  function saveAndNext(player) {
    saveRating(player, draftRating(player));
    const roster = selectedRoster(); const index = roster.findIndex((item) => playerId(item) === playerId(player)); const next = roster[index + 1];
    if (next) { selectedPlayerId = playerId(next); completionMessage = ""; render(); renderEditor(next); }
    else { completionMessage = "Squadra completata"; render(); renderEditor(player); }
  }

  function download(filename, text) {
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function ratedPlayerPayload(player) {
    const rating = normalizeRating(ratings[playerId(player)]); const overall = overallFor(player, rating);
    return { playerId: playerId(player), name: player.name || "", position: player.position || player.role || "", ...Object.fromEntries(STAT_DEFS.map(([stat]) => [stat, rating[stat]])), overall, category: categoryFor(overall) };
  }

  function selectedTeamExportPayload(team) {
    const ratedPlayers = playersForTeam(team).filter(isRated).map(ratedPlayerPayload);
    const overalls = ratedPlayers.map((player) => player.overall);
    const teamOverall = overalls.length ? Math.round(overalls.reduce((sum, value) => sum + value, 0) / overalls.length) : null;
    return { teamId: String(team.id ?? ""), teamName: team.name || "", teamOverall, teamStars: starsFor(teamOverall), ratedPlayers: ratedPlayers.length, totalPlayers: playersForTeam(team).length, players: ratedPlayers };
  }

  function exportRatingsJson() {
    const payload = players.filter(isRated).map((player) => {
      const rating = normalizeRating(ratings[playerId(player)]); const overall = overallFor(player, rating);
      return { playerId: playerId(player), ...Object.fromEntries(STAT_DEFS.map(([stat]) => [stat, rating[stat]])), overall, category: categoryFor(overall) };
    });
    download("ratings.json", JSON.stringify(payload, null, 2));
  }

  function exportTeamsRatedJson() {
    const payload = teams.map((team) => { const summary = teamSummary(team); return { teamId: String(team.id ?? ""), teamName: team.name || "", teamOverall: summary.teamOverall, teamStars: summary.teamStars, ratedPlayers: summary.ratedPlayers, totalPlayers: summary.totalPlayers }; });
    download("teams.rated.json", JSON.stringify(payload, null, 2));
  }

  function renderSelectedTeamsExport() {
    if (!nodes.exportTeamList || !nodes.exportSelectedTeams || !nodes.exportFeedback) return;
    const fragment = document.createDocumentFragment();
    teams.forEach((team) => {
      const summary = teamSummary(team);
      const row = document.createElement("label"); row.className = "ratings-export-team-row";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = selectedExportTeamIds.has(team.id);
      checkbox.addEventListener("change", () => { checkbox.checked ? selectedExportTeamIds.add(team.id) : selectedExportTeamIds.delete(team.id); renderSelectedTeamsExport(); });
      const text = document.createElement("span"); text.className = "ratings-export-team-row__text";
      const name = document.createElement("strong"); name.textContent = team.name || team.id || "Squadra";
      const meta = document.createElement("small"); meta.textContent = `${summary.ratedPlayers}/${summary.totalPlayers} valutati · ${summary.teamOverall === null ? "OVR -- · ★ --" : `OVR ${summary.teamOverall} · ★ ${summary.teamStars}`}`;
      text.append(name, meta); row.append(checkbox, imageOrPlaceholder(team.logoUrl, `${team.name} logo`, team.name, "team-logo team-logo--tiny"), text); fragment.append(row);
    });
    nodes.exportTeamList.replaceChildren(fragment);
    const selectedCount = selectedExportTeamIds.size;
    nodes.exportSelectedTeams.disabled = selectedCount === 0;
    if (selectedCount === 0) nodes.exportFeedback.textContent = "Seleziona almeno una squadra da esportare.";
    else {
      const zeroRated = teams.filter((team) => selectedExportTeamIds.has(team.id) && teamSummary(team).ratedPlayers === 0).length;
      nodes.exportFeedback.textContent = zeroRated ? `${selectedCount} squadre selezionate. Alcune squadre selezionate non hanno giocatori valutati.` : `${selectedCount} squadre selezionate.`;
    }
  }

  function exportSelectedTeamsRatingsJson() {
    if (!selectedExportTeamIds.size) { if (nodes.exportFeedback) nodes.exportFeedback.textContent = "Seleziona almeno una squadra da esportare."; return; }
    const selectedTeams = teams.filter((team) => selectedExportTeamIds.has(team.id));
    const payload = selectedTeams.map(selectedTeamExportPayload);
    const exportedPlayers = payload.reduce((sum, team) => sum + team.players.length, 0);
    const zeroRated = payload.some((team) => team.players.length === 0);
    download("selected-teams-ratings.json", JSON.stringify(payload, null, 2));
    if (nodes.exportFeedback) nodes.exportFeedback.textContent = `Export creato: ${payload.length} squadre, ${exportedPlayers} giocatori valutati.${zeroRated ? " Alcune squadre selezionate non hanno giocatori valutati." : ""}`;
  }

  function render() {
    if (!nodes.debug || !nodes.teams || !nodes.players) return;
    document.body.classList.toggle("ratings-teams-collapsed", teamsCollapsed);
    if (nodes.toggleTeams) nodes.toggleTeams.textContent = teamsCollapsed ? "Mostra squadre" : "Nascondi squadre";
    renderDebug(); renderProgress(); renderTeams(); renderSelectedTeamBar(); renderPlayers(); renderEditor(); renderSelectedTeamsExport();
  }

  nodes.search?.addEventListener("input", () => { playerSearch = nodes.search.value; renderPlayers(); });
  nodes.status?.addEventListener("change", () => { statusFilter = nodes.status.value; renderPlayers(); });
  nodes.toggleTeams?.addEventListener("click", () => { teamsCollapsed = !teamsCollapsed; render(); });
  nodes.exportRatings?.addEventListener("click", exportRatingsJson);
  nodes.exportTeams?.addEventListener("click", exportTeamsRatedJson);
  nodes.exportSelectAll?.addEventListener("click", () => { teams.forEach((team) => selectedExportTeamIds.add(team.id)); renderSelectedTeamsExport(); });
  nodes.exportClear?.addEventListener("click", () => { selectedExportTeamIds.clear(); renderSelectedTeamsExport(); });
  nodes.exportRatedOnly?.addEventListener("click", () => { selectedExportTeamIds.clear(); teams.filter((team) => teamSummary(team).ratedPlayers > 0).forEach((team) => selectedExportTeamIds.add(team.id)); renderSelectedTeamsExport(); });
  nodes.exportSelectedTeams?.addEventListener("click", exportSelectedTeamsRatingsJson);
  globalThis.InazumaPlayerRatings = { render, playersForTeam, overallFor, categoryFor, starsFor, exportRatingsJson, exportTeamsRatedJson, exportSelectedTeamsRatingsJson };
})();
