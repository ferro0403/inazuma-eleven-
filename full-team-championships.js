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
    dialog: $("#championship-dialog"), form: $("#championship-form"), id: $("#championship-id"), title: $("#championship-title"), name: $("#championship-name"), teamSelect: $("#championship-team-select"), addTeam: $("#add-championship-team"), panels: $("#championship-team-panels"), errors: $("#championship-errors"), delete: $("#delete-championship"),
    rosterDialog: $("#championship-roster-dialog"), rosterTitle: $("#championship-roster-title"), rosterSearch: $("#championship-roster-search"), rosterList: $("#championship-roster-list"), rosterReset: $("#reset-championship-roster"), rosterSave: $("#save-championship-roster"),
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

  function renderTeamSelect() {
    const used = new Set(editingChampionship.teams.map((entry) => entry.teamId));
    nodes.teamSelect.replaceChildren(new Option("Choose full team…", ""));
    teams().filter((team) => !used.has(team.id)).forEach((team) => nodes.teamSelect.add(new Option(`${team.name} (${team.playerIds.length} players)`, team.id)));
    nodes.teamSelect.value = "";
  }

  function rosterPreview(entry, team) {
    const list = document.createElement("div"); list.className = "selected-player-list";
    entry.playerIds.slice(0, 12).forEach((playerId) => { const player = playerById.get(Number(playerId)); const item = document.createElement("span"); item.className = "selected-player"; if (!player) item.textContent = `Missing player ${playerId}`; else { const img = document.createElement("img"); img.src = player.imageUrl; img.alt = ""; img.loading = "lazy"; item.append(img, document.createTextNode(player.name)); } list.append(item); });
    if (entry.playerIds.length > 12) { const more = document.createElement("span"); more.className = "selected-player"; more.textContent = `+${entry.playerIds.length - 12} more`; list.append(more); }
    if (!entry.playerIds.length && team) { const empty = document.createElement("span"); empty.className = "selected-player"; empty.textContent = "No players selected"; list.append(empty); }
    return list;
  }

  function teamPanel(entry, index) {
    const team = teamById().get(entry.teamId);
    const panel = document.createElement("section"); panel.className = "tournament-team-panel";
    const header = document.createElement("header"); header.append(logo(team, "team-logo team-logo--card"));
    const text = document.createElement("div"); const name = document.createElement("h3"); name.textContent = team?.name || entry.teamId; const count = document.createElement("p"); count.textContent = `${entry.playerIds.length} players`; text.append(name, count);
    const actions = document.createElement("div"); actions.className = "card-actions";
    const editRoster = document.createElement("button"); editRoster.type = "button"; editRoster.className = "button"; editRoster.textContent = "Edit roster"; editRoster.addEventListener("click", () => openRosterEditor(index));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button--quiet"; remove.textContent = "Remove team"; remove.addEventListener("click", () => { editingChampionship.teams.splice(index, 1); upsertEditing(); renderEditor(); });
    actions.append(editRoster, remove); header.append(text, actions); panel.append(header, rosterPreview(entry, team)); return panel;
  }

  function renderEditor() {
    nodes.name.value = editingChampionship.name; nodes.title.textContent = editingChampionship.name; renderTeamSelect();
    const fragment = document.createDocumentFragment(); editingChampionship.teams.forEach((entry, index) => fragment.append(teamPanel(entry, index))); nodes.panels.replaceChildren(fragment);
    const result = validation(editingChampionship); nodes.errors.replaceChildren(...result.errors.map((error) => Object.assign(document.createElement("p"), { textContent: error })));
  }

  function openChampionship(id) {
    const championship = championships.find((item) => item.id === id); if (!championship) return;
    editingChampionship = Store.normalizeChampionship(JSON.parse(JSON.stringify(championship))); nodes.id.value = championship.id; renderEditor(); nodes.dialog.showModal();
  }

  function createChampionship() {
    editingChampionship = Store.create(`Championship ${championships.length + 1}`, championships); upsertEditing(); nodes.id.value = editingChampionship.id; renderEditor(); nodes.dialog.showModal();
  }

  function addSelectedTeam() {
    const team = teamById().get(nodes.teamSelect.value); if (!team) return;
    editingChampionship.teams.push(Store.fullTeamEntry(team)); nodes.teamSelect.value = ""; upsertEditing(); renderEditor();
  }

  function saveChampionship() { if (!editingChampionship || !nodes.name.value.trim()) return; editingChampionship.name = nodes.name.value.trim(); upsertEditing(); }

  function deleteChampionship() { if (!editingChampionship || !window.confirm(`Delete “${editingChampionship.name}”?`)) return; championships = championships.filter((item) => item.id !== editingChampionship.id); persist(); nodes.dialog.close(); render(); }

  function exportChampionships() { try { download("full-team-championships.js", Store.exportText(championships, teams(), players)); } catch (error) { window.alert(`Cannot export full team championships until validation passes:\n\n${error.message}`); } }

  function openRosterEditor(index) { rosterEditIndex = index; nodes.rosterSearch.value = ""; renderRosterEditor(); nodes.rosterDialog.showModal(); }

  function renderRosterEditor() {
    const entry = editingChampionship.teams[rosterEditIndex]; const team = teamById().get(entry.teamId); if (!team) return;
    const needle = nodes.rosterSearch.value.trim().toLocaleLowerCase(); nodes.rosterTitle.textContent = `${team.name} roster`;
    const fragment = document.createDocumentFragment(); teamPlayers(team).filter((player) => !needle || player.name.toLocaleLowerCase().includes(needle)).forEach((player) => {
      const label = document.createElement("label"); label.className = "tournament-player"; const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = entry.playerIds.includes(Number(player.id));
      checkbox.addEventListener("change", () => { if (checkbox.checked) entry.playerIds = [...new Set([...entry.playerIds, Number(player.id)])]; else entry.playerIds = entry.playerIds.filter((id) => id !== Number(player.id)); upsertEditing(); renderRosterEditor(); renderEditor(); });
      const img = document.createElement("img"); img.src = player.imageUrl; img.alt = ""; img.loading = "lazy"; const text = document.createElement("span"); text.innerHTML = `<strong></strong><small></small>`; text.querySelector("strong").textContent = player.name; text.querySelector("small").textContent = `${player.position || "—"} · ${player.element || "Unknown"}`; label.append(checkbox, img, text); fragment.append(label);
    }); nodes.rosterList.replaceChildren(fragment);
  }

  function resetRoster() { const entry = editingChampionship.teams[rosterEditIndex]; const team = teamById().get(entry.teamId); Store.resetToFullRoster(entry, team); upsertEditing(); renderRosterEditor(); renderEditor(); }

  nodes.create.addEventListener("click", createChampionship); nodes.export.addEventListener("click", exportChampionships); nodes.addTeam.addEventListener("click", addSelectedTeam); nodes.form.addEventListener("submit", (event) => { if (event.submitter?.value === "default") saveChampionship(); }); nodes.name.addEventListener("input", () => { if (!editingChampionship) return; editingChampionship.name = nodes.name.value; nodes.title.textContent = nodes.name.value || "Championship"; if (nodes.name.value.trim()) upsertEditing(); }); nodes.delete.addEventListener("click", deleteChampionship); nodes.rosterSearch.addEventListener("input", renderRosterEditor); nodes.rosterReset.addEventListener("click", resetRoster);
  globalThis.InazumaFullTeamChampionships = { render };
  render();
})();
