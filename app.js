(() => {
  "use strict";

  const players = Array.isArray(globalThis.INAZUMA_PLAYERS) ? globalThis.INAZUMA_PLAYERS : [];
  const seeds = Array.isArray(globalThis.INAZUMA_TEAMS) ? globalThis.INAZUMA_TEAMS : [];
  const Store = globalThis.InazumaTeamStore;
  const PAGE_SIZE = 48;
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const state = { search: "", team: "", position: "", element: "", page: 1, teamSearch: "", selectedTeams: new Set(), editingTeam: null };
  const elementClass = { Fire: "fire", Forest: "forest", Wind: "wind", Mountain: "mountain" };
  const elementSymbol = { Fire: "◆", Forest: "✦", Wind: "➶", Mountain: "▲" };
  let teams = Store.hydrate(players, seeds, Store.load(localStorage));

  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    views: { players: $("#players-view"), teams: $("#teams-view") }, tabs: [...document.querySelectorAll(".view-tab")],
    search: $("#search"), team: $("#team-filter"), position: $("#position-filter"), element: $("#element-filter"), reset: $("#reset-filters"), emptyReset: $("#empty-reset"),
    grid: $("#player-grid"), empty: $("#empty-state"), pagination: $("#pagination"), count: $("#result-count"), total: $("#total-count"),
    teamGrid: $("#team-grid"), teamCount: $("#team-count"), teamSearch: $("#team-search"), createTeam: $("#create-team"), mergeTeams: $("#merge-teams"), exportTeams: $("#export-teams"),
    dialog: $("#team-dialog"), form: $("#team-form"), dialogTitle: $("#dialog-title"), dialogLogo: $("#dialog-logo"), teamId: $("#team-id"), teamName: $("#team-name"), logoUrl: $("#team-logo-url"), aliases: $("#team-aliases"), notes: $("#team-notes"), setLogo: $("#set-logo"), deleteTeam: $("#delete-team"),
    addPlayer: $("#add-player"), addPlayerButton: $("#add-player-button"), rosterList: $("#roster-list"), rosterCount: $("#roster-count"),
    mergeDialog: $("#merge-dialog"), mergeSummary: $("#merge-summary"), mergeTarget: $("#merge-target"), confirmMerge: $("#confirm-merge"),
  };

  const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort(collator.compare);
  const playerById = new Map(players.map((player) => [Number(player.id), player]));
  const teamById = () => new Map(teams.map((team) => [team.id, team]));
  const persist = () => Store.save(localStorage, teams);
  const teamPlayers = (team) => team.playerIds.map((id) => playerById.get(Number(id))).filter(Boolean).sort((a, b) => collator.compare(a.name, b.name));
  const teamsForPlayer = (playerId) => teams.filter((team) => team.playerIds.includes(Number(playerId)));

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
    if (view === "teams") renderTeams(); else renderPlayers();
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
      const searchable = `${player.name || ""} ${player.nickname || ""}`.toLocaleLowerCase();
      return (!needle || searchable.includes(needle))
        && (!selected || selected.playerIds.includes(Number(player.id)))
        && (!state.position || player.position === state.position)
        && (!state.element || player.element === state.element);
    });
  }

  function playerCard(player) {
    const article = document.createElement("article"); article.className = "player-card";
    const portrait = document.createElement("div"); portrait.className = "player-card__portrait";
    const image = document.createElement("img"); image.src = player.imageUrl; image.alt = `${player.name} portrait`; image.loading = "lazy"; image.decoding = "async";
    image.addEventListener("error", () => article.classList.add("player-card--image-error"), { once: true }); portrait.append(image);
    const position = document.createElement("span"); position.className = "position-badge"; position.textContent = player.position || "—"; portrait.append(position);
    const body = document.createElement("div"); body.className = "player-card__body";
    const meta = document.createElement("p"); meta.className = "player-card__meta"; meta.textContent = `NO. ${player.id}`;
    const name = document.createElement("h3"); name.textContent = player.name;
    const teamLine = document.createElement("div"); teamLine.className = "player-card__teams";
    const memberships = teamsForPlayer(player.id);
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
    const image = document.createElement("img"); image.src = player.imageUrl; image.alt = ""; image.loading = "lazy"; person.append(image, document.createTextNode(player.name));
    const move = document.createElement("select"); move.setAttribute("aria-label", `Move ${player.name}`); move.add(new Option("Move to…", "")); teams.filter((team) => team.id !== state.editingTeam.id).forEach((team) => move.add(new Option(team.name, team.id)));
    move.addEventListener("change", () => { if (!move.value) return; const target = teamById().get(move.value); Store.removePlayer(state.editingTeam, player.id); Store.addPlayer(target, player.id); persist(); renderRoster(); renderTeams(); refreshTeamFilter(); renderPlayers(); });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "icon-button"; remove.textContent = "Remove"; remove.addEventListener("click", () => { Store.removePlayer(state.editingTeam, player.id); renderRoster(); });
    row.append(person, move, remove); return row;
  }

  function renderRoster() {
    const roster = teamPlayers(state.editingTeam); nodes.rosterCount.textContent = `${roster.length} players`;
    const fragment = document.createDocumentFragment(); roster.forEach((player) => fragment.append(rosterRow(player))); nodes.rosterList.replaceChildren(fragment);
    nodes.addPlayer.replaceChildren(new Option("Choose a player…", "")); players.filter((player) => !state.editingTeam.playerIds.includes(Number(player.id))).sort((a, b) => collator.compare(a.name, b.name)).forEach((player) => nodes.addPlayer.add(new Option(player.name, player.id)));
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
    teams = Store.hydrate(players, [], teams);
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
  renderPlayers(); renderTeams();
})();
