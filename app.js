(() => {
  "use strict";

  const officialPlayers = Array.isArray(globalThis.INAZUMA_PLAYERS) ? globalThis.INAZUMA_PLAYERS : [];
  const CustomPlayers = globalThis.InazumaCustomPlayers;
  let customPlayers = CustomPlayers?.load(localStorage) || [];
  let players = [...officialPlayers, ...customPlayers];
  const seeds = Array.isArray(globalThis.INAZUMA_TEAMS) ? globalThis.INAZUMA_TEAMS : [];
  const Store = globalThis.InazumaTeamStore;
  const Tournaments = globalThis.InazumaTournamentStore;
  const PAGE_SIZE = 48;
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const state = { search: "", team: "", position: "", element: "", page: 1, teamSearch: "", selectedTeams: new Set(), editingTeam: null, editingTournament: null, tournamentDraft: { teamId: "", playerIds: [], editIndex: null } };
  const elementClass = { Fire: "fire", Forest: "forest", Wind: "wind", Mountain: "mountain" };
  const elementSymbol = { Fire: "◆", Forest: "✦", Wind: "➶", Mountain: "▲" };
  let teams = Store.hydrate(officialPlayers, seeds, Store.load(localStorage));
  let tournaments = Tournaments.load(localStorage);

  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    views: { players: $("#players-view"), teams: $("#teams-view"), tournaments: $("#tournaments-view"), championships: $("#championships-view"), ratings: $("#ratings-view"), custom: $("#custom-view") }, tabs: [...document.querySelectorAll(".view-tab")],
    search: $("#search"), team: $("#team-filter"), position: $("#position-filter"), element: $("#element-filter"), reset: $("#reset-filters"), emptyReset: $("#empty-reset"),
    grid: $("#player-grid"), empty: $("#empty-state"), pagination: $("#pagination"), count: $("#result-count"), total: $("#total-count"),
    teamGrid: $("#team-grid"), teamCount: $("#team-count"), teamSearch: $("#team-search"), createTeam: $("#create-team"), mergeTeams: $("#merge-teams"), exportTeams: $("#export-teams"),
    dialog: $("#team-dialog"), form: $("#team-form"), dialogTitle: $("#dialog-title"), dialogLogo: $("#dialog-logo"), teamId: $("#team-id"), teamName: $("#team-name"), logoUrl: $("#team-logo-url"), aliases: $("#team-aliases"), notes: $("#team-notes"), setLogo: $("#set-logo"), deleteTeam: $("#delete-team"),
    addPlayer: $("#add-player"), addPlayerButton: $("#add-player-button"), rosterList: $("#roster-list"), rosterCount: $("#roster-count"),
    mergeDialog: $("#merge-dialog"), mergeSummary: $("#merge-summary"), mergeTarget: $("#merge-target"), confirmMerge: $("#confirm-merge"),
    tournamentGrid: $("#tournament-grid"), tournamentCount: $("#tournament-count"), createTournament: $("#create-tournament"), exportTournaments: $("#export-tournaments"),
    customForm: $("#custom-player-form"), customEditId: $("#custom-edit-id"), customGeneratedId: $("#custom-generated-id"), customFirstName: $("#custom-first-name"), customLastName: $("#custom-last-name"), customDisplayName: $("#custom-display-name"), customPosition: $("#custom-position"), customElement: $("#custom-element"), customPortrait: $("#custom-portrait"), customTeams: $("#custom-teams"), customNotes: $("#custom-notes"), customPreview: $("#custom-preview"), customFeedback: $("#custom-feedback"), customList: $("#custom-player-list"), customCancel: $("#custom-cancel-edit"), customExport: $("#export-custom-players"), customImport: $("#import-custom-players"),
    tournamentDialog: $("#tournament-dialog"), tournamentForm: $("#tournament-form"), tournamentTitle: $("#tournament-title"), tournamentId: $("#tournament-id"), tournamentName: $("#tournament-name"), tournamentTeamSearch: $("#tournament-team-search"), tournamentTeamCards: $("#tournament-team-cards"), addTournamentTeam: $("#add-tournament-team"), tournamentPicker: $("#tournament-player-picker"), tournamentPickerMessage: $("#tournament-picker-message"), tournamentPanels: $("#tournament-team-panels"), tournamentErrors: $("#tournament-errors"), deleteTournament: $("#delete-tournament"),
  };

  const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort(collator.compare);
  let playerById = new Map(players.map((player) => [String(player.id), player]));
  const teamById = () => new Map(teams.map((team) => [team.id, team]));
  const persist = () => Store.save(localStorage, teams);
  const persistTournaments = () => Tournaments.save(localStorage, tournaments);
  const playerNumericId = (player) => Number(player?.id);
  function refreshPlayersCache() { customPlayers = CustomPlayers?.load(localStorage) || []; players = [...officialPlayers, ...customPlayers]; playerById = new Map(players.map((player) => [String(player.id), player])); }
  const teamPlayers = (team) => { const official = team.playerIds.map((id) => playerById.get(String(id))).filter(Boolean); const custom = CustomPlayers?.customPlayersForTeam(team, customPlayers) || []; return [...official, ...custom].sort((a, b) => collator.compare(a.name, b.name)); };
  const teamsForPlayer = (player) => teams.filter((team) => { const numeric = playerNumericId(player); return (Number.isFinite(numeric) && team.playerIds.includes(numeric)) || CustomPlayers?.isPlayerInTeam(player, team); });

  function logo(team, className = "team-logo") {
    const box = document.createElement("span");
    box.className = className;
    if (team?.logoUrl) {
      const image = document.createElement("img");
      image.src = team.logoUrl; image.alt = `${team.name} logo`; image.loading = "lazy";
      image.addEventListener("error", () => { image.remove(); box.textContent = team.name.slice(0, 2).toUpperCase(); }, { once: true });
      box.append(image);
    } else box.textContent = (team?.name || "?").slice(0, 2).toUpperCase();
    return box;
  }

  function switchView(view) {
    Object.entries(nodes.views).forEach(([name, node]) => { node.hidden = name !== view; });
    nodes.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
    if (view === "teams") renderTeams();
    else if (view === "tournaments") renderTournaments();
    else if (view === "championships") globalThis.InazumaFullTeamChampionships?.render();
    else if (view === "ratings") { globalThis.InazumaPlayerRatings?.refresh?.(); globalThis.InazumaPlayerRatings?.render?.(); }
    else if (view === "custom") renderCustomPlayers();
    else renderPlayers();
  }

  function refreshTeamFilter() {
    const current = nodes.team.value;
    nodes.team.replaceChildren(new Option("All teams", ""));
    teams.forEach((team) => nodes.team.add(new Option(team.name, team.id)));
    nodes.team.value = teams.some((team) => team.id === current) ? current : "";
  }

  function matchingPlayers() {
    const needle = state.search.trim().toLocaleLowerCase();
    const selected = teamById().get(state.team);
    return players.filter((player) => {
      const searchable = `${player.id || ""} ${player.playerId || ""} ${player.name || ""} ${player.firstName || ""} ${player.lastName || ""} ${player.displayName || ""} ${player.nickname || ""} ${player.position || ""} ${player.element || ""} ${teamsForPlayer(player).map((team) => team.name).join(" ")}`.toLocaleLowerCase();
      return (!needle || searchable.includes(needle))
        && (!selected || teamsForPlayer(player).some((team) => team.id === selected.id))
        && (!state.position || player.position === state.position)
        && (!state.element || player.element === state.element);
    });
  }

  function playerCard(player) {
    const article = document.createElement("article"); article.className = "player-card";
    const portrait = document.createElement("div"); portrait.className = "player-card__portrait";
    const image = document.createElement("img"); image.src = player.imageUrl || player.portraitUrl || ""; image.alt = `${player.name} portrait`; image.loading = "lazy"; image.decoding = "async";
    image.addEventListener("error", () => article.classList.add("player-card--image-error"), { once: true }); portrait.append(image);
    const position = document.createElement("span"); position.className = "position-badge"; position.textContent = player.position || "—"; portrait.append(position);
    const body = document.createElement("div"); body.className = "player-card__body";
    const meta = document.createElement("p"); meta.className = "player-card__meta"; meta.textContent = `NO. ${player.id}`; if (player.custom) { const badge = document.createElement("span"); badge.className = "custom-badge"; badge.textContent = "CUSTOM"; meta.append(" ", badge); }
    const name = document.createElement("h3"); name.textContent = player.name;
    const teamLine = document.createElement("div"); teamLine.className = "player-card__teams";
    const memberships = teamsForPlayer(player);
    if (memberships.length) memberships.forEach((team) => {
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "team-chip"; chip.append(logo(team, "team-logo team-logo--tiny"), document.createTextNode(team.name));
      chip.addEventListener("click", () => openTeam(team.id)); teamLine.append(chip);
    }); else { const none = document.createElement("span"); none.className = "player-card__team"; none.textContent = "Unaffiliated"; teamLine.append(none); }
    const element = document.createElement("span"); element.className = `element element--${elementClass[player.element] || "neutral"}`;
    const symbol = document.createElement("span"); symbol.setAttribute("aria-hidden", "true"); symbol.textContent = elementSymbol[player.element] || "●"; element.append(symbol, ` ${player.element || "Unknown"}`);
    body.append(meta, name, teamLine, element); article.append(portrait, body); return article;
  }

  function pageItems(totalPages, current) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const pages = [...new Set([1, totalPages, current - 1, current, current + 1])].filter((page) => page > 0 && page <= totalPages).sort((a, b) => a - b);
    return pages.flatMap((page, index) => index && page - pages[index - 1] > 1 ? ["…", page] : [page]);
  }

  function renderPagination(total) {
    const totalPages = Math.ceil(total / PAGE_SIZE); nodes.pagination.replaceChildren(); if (totalPages <= 1) return;
    const button = (label, page, disabled = false, current = false) => {
      const item = document.createElement("button"); item.type = "button"; item.textContent = label; item.disabled = disabled;
      if (current) item.setAttribute("aria-current", "page"); item.addEventListener("click", () => { state.page = page; renderPlayers(); $(".results__heading").scrollIntoView({ behavior: "smooth" }); }); return item;
    };
    nodes.pagination.append(button("Previous", state.page - 1, state.page === 1));
    pageItems(totalPages, state.page).forEach((item) => item === "…" ? nodes.pagination.append(Object.assign(document.createElement("span"), { textContent: item })) : nodes.pagination.append(button(String(item), item, false, item === state.page)));
    nodes.pagination.append(button("Next", state.page + 1, state.page === totalPages));
  }

  function renderPlayers() {
    const filtered = matchingPlayers(); state.page = Math.min(state.page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
    const fragment = document.createDocumentFragment(); filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE).forEach((player) => fragment.append(playerCard(player)));
    nodes.grid.replaceChildren(fragment); nodes.empty.hidden = Boolean(filtered.length); nodes.grid.hidden = !filtered.length;
    nodes.count.textContent = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "player" : "players"}`; renderPagination(filtered.length);
  }

  function teamCard(team) {
    const card = document.createElement("article"); card.className = "team-card";
    const select = document.createElement("input"); select.type = "checkbox"; select.className = "team-card__select"; select.checked = state.selectedTeams.has(team.id); select.setAttribute("aria-label", `Select ${team.name}`);
    select.addEventListener("change", () => { select.checked ? state.selectedTeams.add(team.id) : state.selectedTeams.delete(team.id); nodes.mergeTeams.disabled = state.selectedTeams.size < 2; });
    const open = document.createElement("button"); open.type = "button"; open.className = "team-card__open"; open.append(logo(team, "team-logo team-logo--card"));
    const text = document.createElement("span"); text.className = "team-card__text"; const name = document.createElement("strong"); name.textContent = team.name;
    const stats = document.createElement("span"); stats.textContent = `${team.playerIds.length} players · ${team.aliases.length} aliases`; text.append(name, stats); open.append(text); open.addEventListener("click", () => openTeam(team.id));
    card.append(select, open); return card;
  }

  function renderTeams() {
    const needle = state.teamSearch.toLocaleLowerCase();
    const shown = teams.filter((team) => !needle || `${team.name} ${team.aliases.join(" ")}`.toLocaleLowerCase().includes(needle));
    const fragment = document.createDocumentFragment(); shown.forEach((team) => fragment.append(teamCard(team))); nodes.teamGrid.replaceChildren(fragment);
    nodes.teamCount.textContent = `${shown.length} of ${teams.length} teams`; nodes.mergeTeams.disabled = state.selectedTeams.size < 2;
  }

  function updateDialogLogo() {
    const preview = Store.normalizeTeam({ name: nodes.teamName.value || "Team", logoUrl: nodes.logoUrl.value }); nodes.dialogLogo.replaceWith(logo(preview, "team-logo team-logo--large")); nodes.dialogLogo = $("#team-dialog .team-logo--large");
  }

  function rosterRow(player) {
    const row = document.createElement("div"); row.className = "roster-row";
    const person = document.createElement("span"); person.className = "roster-person";
    const image = document.createElement("img"); image.src = player.imageUrl || player.portraitUrl || ""; image.alt = ""; image.loading = "lazy"; person.append(image, document.createTextNode(player.name));
    const move = document.createElement("select"); move.setAttribute("aria-label", `Move ${player.name}`); move.add(new Option("Move to…", "")); teams.filter((team) => team.id !== state.editingTeam.id).forEach((team) => move.add(new Option(team.name, team.id)));
    move.addEventListener("change", () => { if (!move.value) return; const target = teamById().get(move.value); Store.removePlayer(state.editingTeam, Number(player.id)); Store.addPlayer(target, player.id); persist(); renderRoster(); renderTeams(); refreshTeamFilter(); renderPlayers(); });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "icon-button"; remove.textContent = "Remove"; remove.addEventListener("click", () => { Store.removePlayer(state.editingTeam, Number(player.id)); renderRoster(); });
    row.append(person, move, remove); return row;
  }

  function renderRoster() {
    const roster = teamPlayers(state.editingTeam); nodes.rosterCount.textContent = `${roster.length} players`;
    const fragment = document.createDocumentFragment(); roster.forEach((player) => fragment.append(rosterRow(player))); nodes.rosterList.replaceChildren(fragment);
    nodes.addPlayer.replaceChildren(new Option("Choose a player…", "")); players.filter((player) => !player.custom && !state.editingTeam.playerIds.includes(Number(player.id))).sort((a, b) => collator.compare(a.name, b.name)).forEach((player) => nodes.addPlayer.add(new Option(player.name, player.id)));
  }

  function openTeam(id) {
    const team = teamById().get(id); if (!team) return; state.editingTeam = team;
    nodes.teamId.value = team.id; nodes.teamName.value = team.name; nodes.logoUrl.value = team.logoUrl; nodes.aliases.value = team.aliases.join("\n"); nodes.notes.value = team.notes; nodes.dialogTitle.textContent = team.name;
    nodes.deleteTeam.hidden = !team.custom; updateDialogLogo(); renderRoster(); nodes.dialog.showModal();
  }

  function saveTeam() {
    if (!state.editingTeam || !nodes.teamName.value.trim()) return;
    const editingId = state.editingTeam.id;
    state.editingTeam.name = nodes.teamName.value.trim(); state.editingTeam.logoUrl = nodes.logoUrl.value.trim(); state.editingTeam.aliases = uniqueSorted(nodes.aliases.value.split("\n").map((value) => value.trim())); state.editingTeam.notes = nodes.notes.value.trim();
    teams = Store.hydrate(officialPlayers, [], teams);
    state.editingTeam = teamById().get(editingId) || null;
    state.selectedTeams = new Set([...state.selectedTeams].filter((id) => teamById().has(id)));
    teams.sort((a, b) => collator.compare(a.name, b.name)); persist(); refreshTeamFilter(); renderTeams(); renderPlayers();
  }

  function createTeam() {
    const name = window.prompt("New team name:"); if (!name?.trim()) return;
    const team = Store.normalizeTeam({ id: Store.nextId(name, teams), name: name.trim(), custom: true }); teams.push(team); persist(); renderTeams(); refreshTeamFilter(); openTeam(team.id);
  }

  function deleteTeam() {
    const team = state.editingTeam; if (!team?.custom) return;
    if (!window.confirm(`Delete custom team “${team.name}”? Its players will remain in the Codex but lose this membership.`)) return;
    Store.backup(localStorage, teams, `Delete ${team.name}`); teams = teams.filter((item) => item.id !== team.id); state.selectedTeams.delete(team.id); persist(); nodes.dialog.close(); refreshTeamFilter(); renderTeams(); renderPlayers();
  }

  function prepareMerge() {
    const selected = teams.filter((team) => state.selectedTeams.has(team.id)); if (selected.length < 2) return;
    nodes.mergeSummary.textContent = `Merge ${selected.map((team) => team.name).join(", ")}. The other names become aliases.`;
    nodes.mergeTarget.replaceChildren(); selected.forEach((team) => nodes.mergeTarget.add(new Option(team.name, team.id))); nodes.mergeDialog.showModal();
  }

  function confirmMerge() {
    const ids = [...state.selectedTeams]; const target = teamById().get(nodes.mergeTarget.value); if (!target) return;
    Store.backup(localStorage, teams, `Merge ${ids.join(", ")} into ${target.name}`); teams = Store.mergeInto(teams, ids, target.id); state.selectedTeams.clear(); persist(); refreshTeamFilter(); renderTeams(); renderPlayers();
  }

  function exportTeams() {
    const payload = `globalThis.INAZUMA_TEAMS = ${JSON.stringify(teams.map(Store.publicTeam), null, 2)};\n`;
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([payload], { type: "text/javascript" })); link.download = "teams.js"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function download(filename, text) {
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], { type: "text/javascript" })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function tournamentValidation(tournament) {
    return Tournaments.validate(tournament, teams, players);
  }

  function renderTournaments() {
    const fragment = document.createDocumentFragment();
    tournaments.forEach((tournament) => {
      const result = tournamentValidation(tournament);
      const card = document.createElement("article"); card.className = `tournament-card ${result.valid ? "" : "tournament-card--invalid"}`;
      const title = document.createElement("h3"); title.textContent = tournament.name;
      const meta = document.createElement("p"); meta.textContent = `${tournament.teams.length} teams · ${result.valid ? "Ready to export" : `${result.errors.length} validation issue(s)`}`;
      const teamLine = document.createElement("div"); teamLine.className = "tournament-card__teams";
      tournament.teams.forEach((entry) => {
        const team = teamById().get(entry.teamId);
        const chip = document.createElement("span"); chip.className = "team-chip"; chip.append(logo(team || { name: entry.teamId }, "team-logo team-logo--tiny"), document.createTextNode(team?.name || entry.teamId)); teamLine.append(chip);
      });
      const actions = document.createElement("div"); actions.className = "card-actions";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "button"; edit.textContent = "Edit"; edit.addEventListener("click", () => openTournament(tournament.id));
      const copy = document.createElement("button"); copy.type = "button"; copy.className = "button button--quiet"; copy.textContent = "Duplicate"; copy.addEventListener("click", () => { tournaments.push(Tournaments.duplicate(tournament, tournaments)); persistTournaments(); renderTournaments(); });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button--danger"; remove.textContent = "Delete"; remove.addEventListener("click", () => { if (window.confirm(`Delete “${tournament.name}”?`)) { tournaments = tournaments.filter((item) => item.id !== tournament.id); persistTournaments(); renderTournaments(); } });
      actions.append(edit, copy, remove); card.append(title, meta, teamLine, actions); fragment.append(card);
    });
    nodes.tournamentGrid.replaceChildren(fragment);
    nodes.tournamentCount.textContent = `${tournaments.length} mini ${tournaments.length === 1 ? "tournament" : "tournaments"}`;
  }

  function playerPill(player) {
    const item = document.createElement("span"); item.className = "selected-player";
    const img = document.createElement("img"); img.src = player.imageUrl || player.portraitUrl || ""; img.alt = ""; img.loading = "lazy";
    item.append(img, document.createTextNode(player.name)); return item;
  }

  function rosterPanel(team) {
    const panel = document.createElement("div"); panel.className = "selectable-team-roster";
    teamPlayers(team).forEach((player) => panel.append(playerPill(player)));
    if (!teamPlayers(team).length) panel.textContent = "No players assigned to this team yet.";
    return panel;
  }

  function renderTournamentTeamCards() {
    const used = new Set(state.editingTournament.teams.map((entry, index) => index === state.tournamentDraft.editIndex ? "" : entry.teamId));
    const needle = nodes.tournamentTeamSearch.value.trim().toLocaleLowerCase();
    const fragment = document.createDocumentFragment();
    teams.filter((team) => !used.has(team.id) && (!needle || team.name.toLocaleLowerCase().includes(needle))).forEach((team) => {
      const card = document.createElement("article"); card.className = "selectable-team-card"; card.tabIndex = 0; card.setAttribute("role", "button"); card.setAttribute("aria-label", `Select ${team.name} for mini tournament`);
      if (state.tournamentDraft.teamId === team.id) card.classList.add("is-selected");
      const text = document.createElement("span"); text.className = "selectable-team-card__text";
      const name = document.createElement("strong"); name.textContent = team.name;
      const count = document.createElement("small"); count.textContent = `${team.playerIds.length} players`;
      const view = document.createElement("button"); view.type = "button"; view.className = "team-card-view"; view.textContent = "View players";
      const roster = rosterPanel(team); roster.hidden = true;
      view.addEventListener("click", (event) => { event.stopPropagation(); roster.hidden = !roster.hidden; });
      text.append(name, count); card.append(logo(team, "team-logo team-logo--card"), text, view, roster);
      const selectTeam = () => { state.tournamentDraft = { teamId: team.id, playerIds: [], editIndex: null }; renderTournamentEditor(); };
      card.addEventListener("click", selectTeam); card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectTeam(); } });
      fragment.append(card);
    });
    if (!fragment.childNodes.length) fragment.append(Object.assign(document.createElement("p"), { className: "picker-empty", textContent: "No available teams match this search." }));
    nodes.tournamentTeamCards.replaceChildren(fragment);
  }

  function upsertEditingTournament() {
    if (!state.editingTournament) return;
    state.editingTournament.updatedAt = new Date().toISOString();
    const normalized = Tournaments.normalizeTournament(state.editingTournament, tournaments.length + 1);
    const existing = tournaments.findIndex((item) => item.id === normalized.id);
    if (existing >= 0) tournaments[existing] = normalized;
    else tournaments.push(normalized);
    state.editingTournament = JSON.parse(JSON.stringify(normalized));
    persistTournaments();
    renderTournaments();
  }

  function resetTournamentDraft() {
    state.tournamentDraft = { teamId: "", playerIds: [], editIndex: null };
  }

  function updateTournamentConfirmState() {
    const selected = state.tournamentDraft.playerIds.length;
    const ready = Boolean(state.tournamentDraft.teamId) && selected === 6;
    nodes.addTournamentTeam.disabled = !ready;
    nodes.addTournamentTeam.textContent = state.tournamentDraft.editIndex === null ? "Add team to tournament" : "Save team changes";
    nodes.tournamentPickerMessage.textContent = selected === 6 ? "6/6 players selected" : "Select 6 players to add this team";
  }

  function renderTournamentPicker() {
    renderTournamentTeamCards();
    const team = teamById().get(state.tournamentDraft.teamId);
    const fragment = document.createDocumentFragment();
    if (team) teamPlayers(team).forEach((player) => {
      const label = document.createElement("label"); label.className = "tournament-player";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = state.tournamentDraft.playerIds.includes(player.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.tournamentDraft.playerIds = [...new Set([...state.tournamentDraft.playerIds, player.id])];
        else state.tournamentDraft.playerIds = state.tournamentDraft.playerIds.filter((id) => id !== player.id);
        renderTournamentPicker();
      });
      const img = document.createElement("img"); img.src = player.imageUrl || player.portraitUrl || ""; img.alt = ""; img.loading = "lazy";
      const text = document.createElement("span"); text.innerHTML = `<strong></strong><small></small>`;
      text.querySelector("strong").textContent = player.name; text.querySelector("small").textContent = `${player.position || "—"} · ${player.element || "Unknown"}`;
      label.append(checkbox, img, text); fragment.append(label);
    });
    else {
      const empty = document.createElement("p"); empty.className = "picker-empty"; empty.textContent = "Choose a team to load its players."; fragment.append(empty);
    }
    nodes.tournamentPicker.replaceChildren(fragment);
    updateTournamentConfirmState();
  }

  function tournamentTeamPanel(entry, index) {
    const team = teamById().get(entry.teamId);
    const panel = document.createElement("section"); panel.className = "tournament-team-panel";
    const header = document.createElement("header"); header.append(logo(team, "team-logo team-logo--card"));
    const title = document.createElement("div"); const name = document.createElement("h3"); name.textContent = team?.name || entry.teamId;
    const count = document.createElement("p"); count.textContent = `${entry.playerIds.length}/6 players selected`; title.append(name, count);
    const actions = document.createElement("div"); actions.className = "card-actions";
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "button"; edit.textContent = "Edit"; edit.addEventListener("click", () => { state.tournamentDraft = { teamId: entry.teamId, playerIds: [...entry.playerIds], editIndex: index }; renderTournamentEditor(); });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button--quiet"; remove.textContent = "Remove"; remove.addEventListener("click", () => { state.editingTournament.teams.splice(index, 1); if (state.tournamentDraft.editIndex === index) resetTournamentDraft(); upsertEditingTournament(); renderTournamentEditor(); });
    actions.append(edit, remove); header.append(title, actions); panel.append(header);
    const list = document.createElement("div"); list.className = "selected-player-list";
    entry.playerIds.forEach((playerId) => {
      const player = playerById.get(String(playerId));
      const item = document.createElement("span"); item.className = "selected-player";
      if (!player) { item.textContent = `Missing player ${playerId}`; list.append(item); return; }
      const img = document.createElement("img"); img.src = player.imageUrl || player.portraitUrl || ""; img.alt = ""; img.loading = "lazy";
      item.append(img, document.createTextNode(player.name)); list.append(item);
    });
    panel.append(list); return panel;
  }

  function renderTournamentEditor() {
    if (!state.editingTournament) return;
    nodes.tournamentName.value = state.editingTournament.name;
    nodes.tournamentTitle.textContent = state.editingTournament.name;
    renderTournamentPicker();
    const fragment = document.createDocumentFragment();
    state.editingTournament.teams.forEach((entry, index) => fragment.append(tournamentTeamPanel(entry, index)));
    nodes.tournamentPanels.replaceChildren(fragment);
    const result = tournamentValidation(state.editingTournament);
    nodes.tournamentErrors.replaceChildren(...result.errors.map((error) => Object.assign(document.createElement("p"), { textContent: error })));
  }

  function openTournament(id) {
    const tournament = tournaments.find((item) => item.id === id); if (!tournament) return;
    state.editingTournament = Tournaments.normalizeTournament(JSON.parse(JSON.stringify(tournament)));
    resetTournamentDraft();
    nodes.tournamentId.value = tournament.id; nodes.deleteTournament.hidden = false; renderTournamentEditor(); nodes.tournamentDialog.showModal();
  }

  function createTournament() {
    state.editingTournament = Tournaments.create(`Mini Tournament ${tournaments.length + 1}`, tournaments);
    resetTournamentDraft();
    upsertEditingTournament();
    nodes.tournamentId.value = state.editingTournament.id; nodes.deleteTournament.hidden = false; renderTournamentEditor(); nodes.tournamentDialog.showModal();
  }

  function saveTournament() {
    if (!state.editingTournament || !nodes.tournamentName.value.trim()) return;
    state.editingTournament.name = nodes.tournamentName.value.trim();
    upsertEditingTournament();
  }

  function exportTournaments() {
    try { download("mini-tournaments.js", Tournaments.exportText(tournaments, teams, players)); }
    catch (error) { window.alert(`Cannot export mini tournaments until validation passes:\n\n${error.message}`); }
  }

  function confirmTournamentTeam() {
    if (!state.editingTournament || !state.tournamentDraft.teamId || state.tournamentDraft.playerIds.length !== 6) return;
    const entry = { teamId: state.tournamentDraft.teamId, playerIds: [...state.tournamentDraft.playerIds] };
    if (state.tournamentDraft.editIndex === null) state.editingTournament.teams.push(entry);
    else state.editingTournament.teams[state.tournamentDraft.editIndex] = entry;
    resetTournamentDraft();
    upsertEditingTournament();
    renderTournamentEditor();
  }


  function customTeamOptions() {
    nodes.customTeams?.replaceChildren();
    teams.forEach((team) => nodes.customTeams.add(new Option(team.name, team.id)));
  }

  function customFormData(id) {
    const firstName = nodes.customFirstName.value.trim();
    const lastName = nodes.customLastName.value.trim();
    const displayName = nodes.customDisplayName.value.trim() || [firstName, lastName].filter(Boolean).join(" ");
    const selectedTeams = [...nodes.customTeams.selectedOptions].map((option) => option.value);
    const previous = customPlayers.find((player) => player.id === id) || {};
    return CustomPlayers.normalize({ ...previous, id: id || CustomPlayers.nextId(customPlayers), firstName, lastName, displayName, name: displayName, position: nodes.customPosition.value, element: nodes.customElement.value, portraitUrl: customPortraitDataUrl || previous.portraitUrl || "", teams: selectedTeams, teamIds: selectedTeams, notes: nodes.customNotes.value }, { keepId: Boolean(id), existing: customPlayers.filter((player) => player.id !== id) });
  }

  let customPortraitDataUrl = "";
  function renderCustomPreview() {
    const id = nodes.customEditId.value || CustomPlayers.nextId(customPlayers);
    const player = customFormData(id) || { id, name: "Anteprima", position: nodes.customPosition.value, element: nodes.customElement.value, portraitUrl: customPortraitDataUrl };
    nodes.customGeneratedId.textContent = `ID generato automaticamente: ${id}`;
    const card = playerCard(player); card.classList.add("custom-preview-card"); nodes.customPreview.replaceChildren(card);
  }

  function renderCustomPlayers() {
    refreshPlayersCache(); customTeamOptions(); renderCustomPreview();
    const fragment = document.createDocumentFragment();
    customPlayers.forEach((player) => {
      const card = document.createElement("article"); card.className = "custom-player-card";
      const img = document.createElement("img"); img.src = player.portraitUrl || player.imageUrl || ""; img.alt = ""; img.loading = "lazy";
      const info = document.createElement("div"); const title = document.createElement("strong"); title.textContent = player.name;
      const meta = document.createElement("small"); const teamNames = teamsForPlayer(player).map((team) => team.name).join(", ") || "Svincolato"; meta.textContent = `${player.id} · ${player.position} · ${player.element} · ${teamNames}`;
      info.append(title, meta);
      const actions = document.createElement("div"); actions.className = "card-actions";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "button"; edit.textContent = "Modifica"; edit.addEventListener("click", () => editCustomPlayer(player.id));
      const del = document.createElement("button"); del.type = "button"; del.className = "button button--danger"; del.textContent = "Elimina"; del.addEventListener("click", () => deleteCustomPlayer(player.id));
      actions.append(edit, del); card.append(img, info, actions); fragment.append(card);
    });
    if (!customPlayers.length) fragment.append(Object.assign(document.createElement("p"), { className: "picker-empty", textContent: "Nessun custom player creato." }));
    nodes.customList.replaceChildren(fragment);
  }

  function resetCustomForm() { nodes.customForm.reset(); nodes.customEditId.value = ""; customPortraitDataUrl = ""; nodes.customCancel.hidden = true; renderCustomPlayers(); }
  function saveCustomPlayer(event) { event.preventDefault(); const id = nodes.customEditId.value; const player = customFormData(id); if (!player) return; const index = customPlayers.findIndex((item) => item.id === player.id); if (index >= 0) customPlayers[index] = player; else customPlayers.push(player); CustomPlayers.save(customPlayers, localStorage); nodes.customFeedback.textContent = `Salvato ${player.name} (${player.id}).`; resetCustomForm(); refreshAllAfterCustomChange(); }
  function editCustomPlayer(id) { const player = customPlayers.find((item) => item.id === id); if (!player) return; nodes.customEditId.value = player.id; nodes.customFirstName.value = player.firstName || ""; nodes.customLastName.value = player.lastName || ""; nodes.customDisplayName.value = player.displayName || player.name || ""; nodes.customPosition.value = player.position || "MF"; nodes.customElement.value = player.element || "Wind"; customPortraitDataUrl = player.portraitUrl || ""; nodes.customNotes.value = player.notes || ""; [...nodes.customTeams.options].forEach((option) => { option.selected = player.teamIds.includes(option.value) || player.teams.includes(option.value); }); nodes.customCancel.hidden = false; renderCustomPreview(); }
  function deleteCustomPlayer(id) { const player = customPlayers.find((item) => item.id === id); if (!player || !confirm(`Eliminare ${player.name}?`)) return; customPlayers = customPlayers.filter((item) => item.id !== id); CustomPlayers.save(customPlayers, localStorage); CustomPlayers.removeRating(id, localStorage); resetCustomForm(); refreshAllAfterCustomChange(); }
  function refreshAllAfterCustomChange() { refreshPlayersCache(); renderPlayers(); renderTeams(); globalThis.InazumaPlayerRatings?.refresh?.(); globalThis.InazumaPlayerRatings?.render?.(); globalThis.InazumaFullTeamChampionships?.render?.(); }
  function exportCustomPlayers() { download("custom-players.json", JSON.stringify(customPlayers, null, 2)); }
  function importCustomPlayers(file) { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const payload = JSON.parse(String(reader.result || "[]")); const records = Array.isArray(payload) ? payload : []; let imported = 0; records.forEach((record) => { const normalized = CustomPlayers.normalize(record, { keepId: true, existing: customPlayers }); if (!normalized) return; if (customPlayers.some((p) => p.id === normalized.id) || officialPlayers.some((p) => String(p.id) === normalized.id || String(p.playerId) === normalized.id)) normalized.id = normalized.playerId = CustomPlayers.nextId(customPlayers); customPlayers.push(normalized); imported += 1; }); CustomPlayers.save(customPlayers, localStorage); nodes.customFeedback.textContent = `Import completato: ${imported} custom players.`; resetCustomForm(); refreshAllAfterCustomChange(); } catch (error) { nodes.customFeedback.textContent = `Import fallito: ${error.message}`; } nodes.customImport.value = ""; }; reader.readAsText(file); }

  nodes.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  uniqueSorted(players.map((player) => player.position)).forEach((value) => nodes.position.add(new Option(value, value)));
  uniqueSorted(players.map((player) => player.element)).forEach((value) => nodes.element.add(new Option(value, value)));
  refreshTeamFilter(); nodes.total.textContent = players.length.toLocaleString();
  let timer; nodes.search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.search = nodes.search.value; state.page = 1; renderPlayers(); }, 100); });
  [[nodes.team, "team"], [nodes.position, "position"], [nodes.element, "element"]].forEach(([select, key]) => select.addEventListener("change", () => { state[key] = select.value; state.page = 1; renderPlayers(); }));
  const reset = () => { state.search = state.team = state.position = state.element = ""; state.page = 1; nodes.search.value = nodes.team.value = nodes.position.value = nodes.element.value = ""; renderPlayers(); };
  nodes.reset.addEventListener("click", reset); nodes.emptyReset.addEventListener("click", reset);
  nodes.teamSearch.addEventListener("input", () => { state.teamSearch = nodes.teamSearch.value; renderTeams(); }); nodes.createTeam.addEventListener("click", createTeam); nodes.mergeTeams.addEventListener("click", prepareMerge); nodes.exportTeams.addEventListener("click", exportTeams);
  nodes.setLogo.addEventListener("click", updateDialogLogo); nodes.logoUrl.addEventListener("change", updateDialogLogo); nodes.form.addEventListener("submit", (event) => { if (event.submitter?.value === "default") saveTeam(); }); nodes.deleteTeam.addEventListener("click", deleteTeam);
  nodes.addPlayerButton.addEventListener("click", () => { if (!nodes.addPlayer.value) return; Store.addPlayer(state.editingTeam, Number(nodes.addPlayer.value)); renderRoster(); });
  nodes.confirmMerge.addEventListener("click", confirmMerge);
  nodes.createTournament.addEventListener("click", createTournament); nodes.exportTournaments.addEventListener("click", exportTournaments);
  nodes.tournamentTeamSearch.addEventListener("input", renderTournamentPicker);
  nodes.addTournamentTeam.addEventListener("click", confirmTournamentTeam);
  nodes.tournamentForm.addEventListener("submit", (event) => { if (event.submitter?.value === "default") saveTournament(); });
  nodes.customForm?.addEventListener("submit", saveCustomPlayer); nodes.customCancel?.addEventListener("click", resetCustomForm); [nodes.customFirstName, nodes.customLastName, nodes.customDisplayName, nodes.customPosition, nodes.customElement, nodes.customNotes, nodes.customTeams].forEach((node) => node?.addEventListener("input", renderCustomPreview)); nodes.customTeams?.addEventListener("change", renderCustomPreview); nodes.customPortrait?.addEventListener("change", () => { const file = nodes.customPortrait.files?.[0]; if (!file) return; if (file.size > 1024 * 1024) nodes.customFeedback.textContent = "Attenzione: immagine grande, localStorage potrebbe riempirsi."; const reader = new FileReader(); reader.onload = () => { customPortraitDataUrl = String(reader.result || ""); renderCustomPreview(); }; reader.readAsDataURL(file); }); nodes.customExport?.addEventListener("click", exportCustomPlayers); nodes.customImport?.addEventListener("change", () => importCustomPlayers(nodes.customImport.files?.[0]));
  nodes.tournamentName.addEventListener("input", () => { if (!state.editingTournament) return; state.editingTournament.name = nodes.tournamentName.value; nodes.tournamentTitle.textContent = nodes.tournamentName.value || "Mini Tournament"; if (nodes.tournamentName.value.trim()) upsertEditingTournament(); });
  nodes.deleteTournament.addEventListener("click", () => { if (!state.editingTournament || !window.confirm(`Delete “${state.editingTournament.name}”?`)) return; tournaments = tournaments.filter((item) => item.id !== state.editingTournament.id); persistTournaments(); nodes.tournamentDialog.close(); renderTournaments(); });
  renderPlayers(); renderTeams(); renderTournaments(); renderCustomPlayers();
})();
