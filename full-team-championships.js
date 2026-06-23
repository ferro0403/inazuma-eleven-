(() => {
  "use strict";
  const players = Array.isArray(globalThis.INAZUMA_PLAYERS) ? globalThis.INAZUMA_PLAYERS : [];
  const seeds = Array.isArray(globalThis.INAZUMA_TEAMS) ? globalThis.INAZUMA_TEAMS : [];
  const TeamStore = globalThis.InazumaTeamStore;
  const Store = globalThis.InazumaFullTeamChampionshipStore;
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const playerById = new Map(players.map((player) => [Number(player.id), player]));
  let championships = Store.load(localStorage);
  let editingChampionship = null;
  let rosterEditIndex = null;
  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    grid: $("#championship-grid"), count: $("#championship-count"), create: $("#create-championship"), export: $("#export-championships"),
    dialog: $("#championship-dialog"), form: $("#championship-form"), id: $("#championship-id"), title: $("#championship-title"), name: $("#championship-name"), teamSearch: $("#championship-team-search"), teamCards: $("#championship-team-cards"), panels: $("#championship-team-panels"), errors: $("#championship-errors"), delete: $("#delete-championship"),
    rosterDialog: $("#championship-roster-dialog"), rosterTitle: $("#championship-roster-title"), rosterSearch: $("#championship-roster-search"), rosterList: $("#championship-roster-list"), rosterReset: $("#reset-championship-roster"), rosterSave: $("#save-championship-roster"), staffSearch: $("#championship-staff-search"), headCoach: $("#championship-head-coach"), staffList: $("#championship-staff-list"),
  };

  const teams = () => TeamStore.hydrate(players, seeds, TeamStore.load(localStorage));
  const teamById = () => new Map(teams().map((team) => [team.id, team]));
  const teamPlayers = (team) => team.playerIds.map((id) => playerById.get(Number(id))).filter(Boolean).sort((a, b) => collator.compare(a.name, b.name));
  const persist = () => Store.save(localStorage, championships);
  const download = (filename, text) => { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], { type: "text/javascript" })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); };

  function logo(team, className = "team-logo") {
    const box = document.createElement("span"); box.className = className;
    if (team?.logoUrl) { const image = document.createElement("img"); image.src = team.logoUrl; image.alt = `${team.name} logo`; image.loading = "lazy"; image.addEventListener("error", () => { image.remove(); box.textContent = team.name.slice(0, 2).toUpperCase(); }, { once: true }); box.append(image); }
    else box.textContent = (team?.name || "?").slice(0, 2).toUpperCase();
    return box;
  }

  function playerPill(player) {
    const item = document.createElement("span"); item.className = "selected-player";
    const img = document.createElement("img"); img.src = player.imageUrl; img.alt = ""; img.loading = "lazy";
    item.append(img, document.createTextNode(player.name)); return item;
  }

  function upsertEditing() {
    if (!editingChampionship) return;
    editingChampionship.updatedAt = new Date().toISOString();
    const normalized = Store.normalizeChampionship(editingChampionship, championships.length + 1);
    const index = championships.findIndex((item) => item.id === normalized.id);
    if (index >= 0) championships[index] = normalized; else championships.push(normalized);
    editingChampionship = JSON.parse(JSON.stringify(normalized));
    persist(); render();
  }

  function validation(championship) { return Store.validate(championship, teams(), players); }

  function championshipCard(championship) {
    const result = validation(championship);
    const card = document.createElement("article"); card.className = `tournament-card ${result.valid ? "" : "tournament-card--invalid"}`;
    const title = document.createElement("h3"); title.textContent = championship.name;
    const meta = document.createElement("p"); meta.textContent = `${championship.teams.length} teams · ${result.valid ? "Ready to export" : `${result.errors.length} validation issue(s)`}`;
    const teamLine = document.createElement("div"); teamLine.className = "tournament-card__teams";
    const map = teamById(); championship.teams.forEach((entry) => { const team = map.get(entry.teamId); const chip = document.createElement("span"); chip.className = "team-chip"; chip.append(logo(team || { name: entry.teamId }, "team-logo team-logo--tiny"), document.createTextNode(team?.name || entry.teamId)); teamLine.append(chip); });
    const actions = document.createElement("div"); actions.className = "card-actions";
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "button"; edit.textContent = "Edit"; edit.addEventListener("click", () => openChampionship(championship.id));
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "button button--quiet"; copy.textContent = "Duplicate"; copy.addEventListener("click", () => { championships.push(Store.duplicate(championship, championships)); persist(); render(); });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button--danger"; remove.textContent = "Delete"; remove.addEventListener("click", () => { if (window.confirm(`Delete “${championship.name}”?`)) { championships = championships.filter((item) => item.id !== championship.id); persist(); render(); } });
    actions.append(edit, copy, remove); card.append(title, meta, teamLine, actions); return card;
  }

  function render() {
    const fragment = document.createDocumentFragment(); championships.forEach((championship) => fragment.append(championshipCard(championship)));
    nodes.grid.replaceChildren(fragment); nodes.count.textContent = `${championships.length} full team ${championships.length === 1 ? "championship" : "championships"}`;
  }

  function rosterPanel(team) {
    const panel = document.createElement("div"); panel.className = "selectable-team-roster"; panel.hidden = true;
    teamPlayers(team).forEach((player) => panel.append(playerPill(player)));
    if (!team.playerIds.length) panel.textContent = "No players assigned to this team yet.";
    return panel;
  }

  function renderTeamCards() {
    const used = new Set(editingChampionship.teams.map((entry) => entry.teamId));
    const needle = nodes.teamSearch.value.trim().toLocaleLowerCase();
    const fragment = document.createDocumentFragment();
    teams().filter((team) => !used.has(team.id) && (!needle || team.name.toLocaleLowerCase().includes(needle))).forEach((team) => {
      const card = document.createElement("article"); card.className = "selectable-team-card"; card.tabIndex = 0; card.setAttribute("role", "button"); card.setAttribute("aria-label", `Add ${team.name} to championship`);
      const text = document.createElement("span"); text.className = "selectable-team-card__text";
      const name = document.createElement("strong"); name.textContent = team.name; const count = document.createElement("small"); count.textContent = `${team.playerIds.length} players`;
      const view = document.createElement("button"); view.type = "button"; view.className = "team-card-view"; view.textContent = "View players";
      const roster = rosterPanel(team); view.addEventListener("click", (event) => { event.stopPropagation(); roster.hidden = !roster.hidden; });
      text.append(name, count); card.append(logo(team, "team-logo team-logo--card"), text, view, roster);
      const add = () => addTeam(team.id); card.addEventListener("click", add); card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); add(); } });
      fragment.append(card);
    });
    if (!fragment.childNodes.length) fragment.append(Object.assign(document.createElement("p"), { className: "picker-empty", textContent: "No available teams match this search." }));
    nodes.teamCards.replaceChildren(fragment);
  }

  function rosterPreview(entry, team) {
    const list = document.createElement("div"); list.className = "selected-player-list";
    entry.playerIds.slice(0, 12).forEach((playerId) => { const player = playerById.get(Number(playerId)); const item = document.createElement("span"); item.className = "selected-player"; if (!player) item.textContent = `Missing player ${playerId}`; else { const img = document.createElement("img"); img.src = player.imageUrl; img.alt = ""; img.loading = "lazy"; item.append(img, document.createTextNode(player.name)); } list.append(item); });
    if (entry.playerIds.length > 12) { const more = document.createElement("span"); more.className = "selected-player"; more.textContent = `+${entry.playerIds.length - 12} more`; list.append(more); }
    if (!entry.playerIds.length && team) { const empty = document.createElement("span"); empty.className = "selected-player"; empty.textContent = "No players selected"; list.append(empty); }
    return list;
  }

  function staffSummary(entry) {
    const summary = document.createElement("p"); summary.className = "picker-message";
    const coach = entry.headCoachId ? playerById.get(Number(entry.headCoachId))?.name || `Missing ${entry.headCoachId}` : "No head coach";
    summary.textContent = `${coach} · ${entry.staffIds.length} staff selected`; return summary;
  }

  function teamPanel(entry, index) {
    const team = teamById().get(entry.teamId);
    const panel = document.createElement("section"); panel.className = "tournament-team-panel";
    const header = document.createElement("header"); header.append(logo(team, "team-logo team-logo--card"));
    const text = document.createElement("div"); const name = document.createElement("h3"); name.textContent = team?.name || entry.teamId; const count = document.createElement("p"); count.textContent = `${entry.playerIds.length} players`; text.append(name, count, staffSummary(entry));
    const actions = document.createElement("div"); actions.className = "card-actions";
    const editRoster = document.createElement("button"); editRoster.type = "button"; editRoster.className = "button"; editRoster.textContent = "Edit roster"; editRoster.addEventListener("click", () => openRosterEditor(index));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button--quiet"; remove.textContent = "Remove team"; remove.addEventListener("click", () => { editingChampionship.teams.splice(index, 1); upsertEditing(); renderEditor(); });
    actions.append(editRoster, remove); header.append(text, actions); panel.append(header, rosterPreview(entry, team)); return panel;
  }

  function renderEditor() {
    nodes.name.value = editingChampionship.name; nodes.title.textContent = editingChampionship.name; renderTeamCards();
    const fragment = document.createDocumentFragment(); editingChampionship.teams.forEach((entry, index) => fragment.append(teamPanel(entry, index))); nodes.panels.replaceChildren(fragment);
    const result = validation(editingChampionship); nodes.errors.replaceChildren(...result.errors.map((error) => Object.assign(document.createElement("p"), { textContent: error })));
  }

  function openChampionship(id) { const championship = championships.find((item) => item.id === id); if (!championship) return; editingChampionship = Store.normalizeChampionship(JSON.parse(JSON.stringify(championship))); nodes.id.value = championship.id; renderEditor(); nodes.dialog.showModal(); }
  function createChampionship() { editingChampionship = Store.create(`Championship ${championships.length + 1}`, championships); upsertEditing(); nodes.id.value = editingChampionship.id; renderEditor(); nodes.dialog.showModal(); }
  function addTeam(teamId) { const team = teamById().get(teamId); if (!team || editingChampionship.teams.some((entry) => entry.teamId === team.id)) return; editingChampionship.teams.push(Store.fullTeamEntry(team)); nodes.teamSearch.value = ""; upsertEditing(); renderEditor(); }
  function saveChampionship() { if (!editingChampionship || !nodes.name.value.trim()) return; editingChampionship.name = nodes.name.value.trim(); upsertEditing(); }
  function deleteChampionship() { if (!editingChampionship || !window.confirm(`Delete “${editingChampionship.name}”?`)) return; championships = championships.filter((item) => item.id !== editingChampionship.id); persist(); nodes.dialog.close(); render(); }
  function exportChampionships() { try { download("full-team-championships.js", Store.exportText(championships, teams(), players)); } catch (error) { window.alert(`Cannot export full team championships until validation passes:\n\n${error.message}`); } }
  function openRosterEditor(index) { rosterEditIndex = index; nodes.rosterSearch.value = ""; nodes.staffSearch.value = ""; renderRosterEditor(); nodes.rosterDialog.showModal(); }

  function renderRosterEditor() {
    const entry = editingChampionship.teams[rosterEditIndex]; const team = teamById().get(entry.teamId); if (!team) return;
    const needle = nodes.rosterSearch.value.trim().toLocaleLowerCase(); nodes.rosterTitle.textContent = `${team.name} roster`;
    const fragment = document.createDocumentFragment(); teamPlayers(team).filter((player) => !needle || player.name.toLocaleLowerCase().includes(needle)).forEach((player) => {
      const label = document.createElement("label"); label.className = "tournament-player"; const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = entry.playerIds.includes(Number(player.id));
      checkbox.addEventListener("change", () => { if (checkbox.checked) entry.playerIds = [...new Set([...entry.playerIds, Number(player.id)])]; else entry.playerIds = entry.playerIds.filter((id) => id !== Number(player.id)); upsertEditing(); renderRosterEditor(); renderEditor(); });
      const img = document.createElement("img"); img.src = player.imageUrl; img.alt = ""; img.loading = "lazy"; const text = document.createElement("span"); text.innerHTML = `<strong></strong><small></small>`; text.querySelector("strong").textContent = player.name; text.querySelector("small").textContent = `${player.position || "—"} · ${player.element || "Unknown"}`; label.append(checkbox, img, text); fragment.append(label);
    }); nodes.rosterList.replaceChildren(fragment); renderStaffEditor(entry, team);
  }

  function staffCandidate(player, entry, mode) {
    const row = document.createElement("label"); row.className = "tournament-player";
    const input = document.createElement("input"); input.type = mode === "coach" ? "radio" : "checkbox"; input.name = mode === "coach" ? "championship-head-coach" : "championship-staff";
    const playerId = Number(player.id); input.checked = mode === "coach" ? entry.headCoachId === playerId : entry.staffIds.includes(playerId); input.disabled = mode === "staff" && entry.headCoachId === playerId;
    input.addEventListener("change", () => {
      if (mode === "coach") { entry.headCoachId = input.checked ? playerId : null; entry.staffIds = entry.staffIds.filter((id) => id !== playerId); }
      else if (input.checked) entry.staffIds = [...new Set([...entry.staffIds, playerId])]; else entry.staffIds = entry.staffIds.filter((id) => id !== playerId);
      upsertEditing(); renderRosterEditor(); renderEditor();
    });
    const img = document.createElement("img"); img.src = player.imageUrl; img.alt = ""; img.loading = "lazy";
    const text = document.createElement("span"); text.innerHTML = `<strong></strong><small></small>`; text.querySelector("strong").textContent = player.name; text.querySelector("small").textContent = `${player.characterRole || "Character"} · ${player.position || "—"}`;
    row.append(input, img, text); return row;
  }

  function renderStaffEditor(entry, team) {
    const needle = nodes.staffSearch.value.trim().toLocaleLowerCase();
    const candidates = teamPlayers(team).filter((player) => !needle || player.name.toLocaleLowerCase().includes(needle));
    const coachHeader = document.createElement("h4"); coachHeader.textContent = "Head coach";
    const clearCoach = document.createElement("button"); clearCoach.type = "button"; clearCoach.className = "button button--quiet"; clearCoach.textContent = "Remove head coach"; clearCoach.disabled = entry.headCoachId === null; clearCoach.addEventListener("click", () => { entry.headCoachId = null; upsertEditing(); renderRosterEditor(); renderEditor(); });
    const coachFragment = document.createDocumentFragment(); coachFragment.append(coachHeader, clearCoach); candidates.forEach((player) => coachFragment.append(staffCandidate(player, entry, "coach"))); nodes.headCoach.replaceChildren(coachFragment);
    const staffHeader = document.createElement("h4"); staffHeader.textContent = "Staff";
    const staffFragment = document.createDocumentFragment(); staffFragment.append(staffHeader); candidates.forEach((player) => staffFragment.append(staffCandidate(player, entry, "staff"))); nodes.staffList.replaceChildren(staffFragment);
  }

  function resetRoster() { const entry = editingChampionship.teams[rosterEditIndex]; const team = teamById().get(entry.teamId); Store.resetToFullRoster(entry, team); upsertEditing(); renderRosterEditor(); renderEditor(); }

  nodes.create.addEventListener("click", createChampionship); nodes.export.addEventListener("click", exportChampionships); nodes.teamSearch.addEventListener("input", renderTeamCards); nodes.form.addEventListener("submit", (event) => { if (event.submitter?.value === "default") saveChampionship(); }); nodes.name.addEventListener("input", () => { if (!editingChampionship) return; editingChampionship.name = nodes.name.value; nodes.title.textContent = nodes.name.value || "Championship"; if (nodes.name.value.trim()) upsertEditing(); }); nodes.delete.addEventListener("click", deleteChampionship); nodes.rosterSearch.addEventListener("input", renderRosterEditor); nodes.staffSearch.addEventListener("input", renderRosterEditor); nodes.rosterReset.addEventListener("click", resetRoster);
  globalThis.InazumaFullTeamChampionships = { render };
  render();
})();
