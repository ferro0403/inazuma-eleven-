(() => {
  "use strict";

  const players = Array.isArray(globalThis.INAZUMA_PLAYERS) ? globalThis.INAZUMA_PLAYERS : [];
  const teams = Array.isArray(globalThis.INAZUMA_TEAMS) ? globalThis.INAZUMA_TEAMS : [];
  const STORAGE_KEY = "inazumaPlayerRatings";
  const EVALUATOR_KEY = "inazumaPlayerRatingsEvaluator";
  const FIRESTORE_PROJECT_PATH = "inazumaRatingProjects/main/ratings";
  const STAT_DEFS = [
    ["attack", "Attacco"], ["physical", "Fisico"], ["stamina", "Resistenza"], ["control", "Controllo"],
    ["defense", "Difesa"], ["speed", "Velocità"], ["grit", "Grinta"], ["save", "Parata"],
  ];
  const DEFAULT_STATS = Object.fromEntries(STAT_DEFS.map(([key]) => [key, 5]));
  const ROLE_WEIGHTS = {
    FW: { attack: 50, control: 12, speed: 10, grit: 8, physical: 10, stamina: 8, defense: 2, save: 0 },
    MF: { control: 40, stamina: 15, grit: 12, speed: 10, attack: 10, defense: 8, physical: 5, save: 0 },
    DF: { defense: 50, physical: 15, grit: 10, stamina: 8, speed: 8, control: 5, attack: 4, save: 0 },
    GK: { save: 70, grit: 10, physical: 8, defense: 5, control: 3, stamina: 2, speed: 2, attack: 0 },
  };
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    debug: $("#ratings-debug"), progress: $("#ratings-progress"), teams: $("#ratings-team-list"), selectedTeam: $("#ratings-selected-team"), heading: $("#ratings-player-heading"), players: $("#ratings-player-list"), editor: $("#ratings-editor"),
    search: $("#ratings-player-search"), status: $("#ratings-status-filter"), toggleTeams: $("#ratings-toggle-teams"), exportRatings: $("#export-ratings"), exportTeams: $("#export-rated-teams"),
    exportTeamList: $("#ratings-export-team-list"), exportSelectAll: $("#ratings-export-select-all"), exportClear: $("#ratings-export-clear"), exportRatedOnly: $("#ratings-export-rated-only"), exportSelectedTeams: $("#export-selected-team-ratings"), exportFeedback: $("#ratings-export-feedback"),
    syncStatus: $("#ratings-sync-status"), syncCount: $("#ratings-sync-count"), evaluatorName: $("#ratings-evaluator-name"), uploadFirestore: $("#ratings-upload-firestore"), importJson: $("#ratings-import-json"),
  };
  const playerById = new Map(players.map((player) => [String(player.id), player]));
  let selectedTeamId = teams[0]?.id || "";
  let selectedPlayerId = "";
  let playerSearch = "";
  let statusFilter = "all";
  let ratings = loadRatings();
  let syncState = { status: "Offline / solo localStorage", firestoreEnabled: false, firestoreLoaded: 0, authUid: "", lastError: "", lastSave: "", evaluatorName: localStorage.getItem(EVALUATOR_KEY) || "", firebaseSdkLoaded: false, firebaseReady: false, authAvailable: false, firestoreAvailable: false, authStatus: "in attesa", listenerActive: false, offlineCause: "" };
  let firestoreSyncStarted = false;
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

  function timestampValue(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function shouldUseIncoming(existing, incoming) {
    const existingTime = timestampValue(existing?.updatedAt);
    const incomingTime = timestampValue(incoming?.updatedAt);
    if (existingTime && incomingTime) return incomingTime >= existingTime;
    if (incomingTime && !existingTime) return true;
    if (!existingTime && !incomingTime && !existing) return true;
    return false;
  }

  function mergeRatingRecord(playerIdValue, record) {
    const id = String(playerIdValue || record?.playerId || "");
    if (!id || !record) return false;
    const normalized = normalizeRating(record);
    if (record.updatedBy) normalized.updatedBy = clean(record.updatedBy);
    if (shouldUseIncoming(ratings[id], normalized)) { ratings[id] = normalized; return true; }
    return false;
  }

  function syncClass(status) {
    const value = key(status);
    if (value.includes("connesso") || value.includes("riuscito")) return "ratings-sync-status--online";
    if (value.includes("connessione") || value.includes("sincronizzazione") || value.includes("attesa")) return "ratings-sync-status--pending";
    if (value.includes("errore") || value.includes("fallita") || value.includes("denied") || value.includes("non riuscita")) return "ratings-sync-status--error";
    return "ratings-sync-status--offline";
  }

  function refreshFirebaseDiagnostics() {
    syncState.firebaseSdkLoaded = Boolean(window.firebase);
    syncState.firebaseReady = Boolean(window.INAZUMA_FIREBASE_READY);
    syncState.authAvailable = Boolean(window.INAZUMA_FIREBASE_AUTH && typeof window.INAZUMA_FIREBASE_AUTH.signInAnonymously === "function");
    syncState.firestoreAvailable = Boolean(window.INAZUMA_FIRESTORE && typeof window.INAZUMA_FIRESTORE.collection === "function");
  }

  function errorText(error) {
    if (!error) return "";
    const code = clean(error.code);
    const message = clean(error.message || error);
    return code ? `${code}: ${message}` : message;
  }

  function readableOfflineCause(error) {
    const text = errorText(error).toLowerCase();
    if (!syncState.firebaseSdkLoaded) return "Firebase SDK non caricato";
    if (!syncState.firebaseReady && (!syncState.authAvailable || !syncState.firestoreAvailable)) return "firebase-config.js non inizializzato";
    if (!syncState.authAvailable) return "Auth Firebase non disponibile";
    if (!syncState.firestoreAvailable) return "Firestore non disponibile";
    if (text.includes("permission-denied") || text.includes("permission denied")) return "Permission denied: controlla le Rules";
    if (text.includes("auth")) return "Anonymous Auth fallita";
    if (location.protocol === "file:") return "Apri il sito da http://localhost, non da file://";
    return errorText(error) || "Offline / solo localStorage";
  }

  function updateSyncStatus(status, error) {
    refreshFirebaseDiagnostics();
    syncState.status = status;
    if (error) { syncState.lastError = errorText(error); syncState.offlineCause = readableOfflineCause(error); }
    if (status.includes("Offline") && !syncState.offlineCause) syncState.offlineCause = readableOfflineCause(error);
    if (!error && (status.includes("connesso") || status.includes("riuscito"))) { syncState.lastError = ""; syncState.offlineCause = ""; }
    if (nodes.syncStatus) {
      nodes.syncStatus.textContent = `Stato sync: ${status}`;
      nodes.syncStatus.className = `ratings-sync-status ${syncClass(status)}`;
    }
    if (nodes.syncCount) nodes.syncCount.textContent = `Rating salvati: ${Object.keys(ratings).length.toLocaleString()}`;
    if (nodes.uploadFirestore) nodes.uploadFirestore.disabled = !syncState.firestoreEnabled;
  }

  function firestoreCollection() {
    const db = window.INAZUMA_FIRESTORE;
    const [projectCollection, projectId, ratingsCollection] = FIRESTORE_PROJECT_PATH.split("/");
    return db && typeof db.collection === "function" ? db.collection(projectCollection).doc(projectId).collection(ratingsCollection) : null;
  }

  function updatedAtString(value) {
    if (!value) return "";
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (typeof value.toMillis === "function") return new Date(value.toMillis()).toISOString();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
    return clean(value);
  }

  function normalizeRating(record = {}) {
    const stats = { ...DEFAULT_STATS };
    STAT_DEFS.forEach(([stat]) => { stats[stat] = clampStat(record[stat]); });
    return { ...stats, updatedAt: updatedAtString(record.updatedAt) || new Date().toISOString() };
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
    const weights = ROLE_WEIGHTS[roleCode(player)] || ROLE_WEIGHTS.MF;
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
      stat("Firebase SDK caricato", syncState.firebaseSdkLoaded ? "sì" : "no"),
      stat("Firebase ready", String(syncState.firebaseReady)),
      stat("Auth disponibile", syncState.authAvailable ? "sì" : "no"),
      stat("Firestore disponibile", syncState.firestoreAvailable ? "sì" : "no"),
      stat("Login anonimo", syncState.authStatus),
      stat("UID utente anonimo", syncState.authUid || "—"),
      stat("Listener Firestore", syncState.listenerActive ? "attivo" : "non attivo"),
      stat("Rating in localStorage", Object.keys(loadRatings()).length.toLocaleString()),
      stat("Rating caricati da Firestore", syncState.firestoreLoaded.toLocaleString()),
      stat("Ultimo errore sync", syncState.lastError || syncState.offlineCause || "—"),
      stat("Fonte dati giocatori", "globalThis.INAZUMA_PLAYERS"), stat("Fonte dati squadre", "globalThis.INAZUMA_TEAMS"),
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
    const id = playerId(player);
    ratings[id] = { ...normalizeRating(rating), updatedAt: new Date().toISOString(), updatedBy: syncState.evaluatorName || "Utente" };
    persistRatings();
    updateSyncStatus(syncState.firestoreEnabled ? syncState.status : "Offline / solo localStorage");
    saveRatingToFirestore(id, ratings[id]);
  }

  function firestorePayload(id, rating) {
    const normalized = normalizeRating(rating);
    const payload = { playerId: String(id), ...Object.fromEntries(STAT_DEFS.map(([stat]) => [stat, normalized[stat]])), overall: overallFor(playerById.get(String(id)), normalized), category: categoryFor(overallFor(playerById.get(String(id)), normalized)), updatedBy: syncState.evaluatorName || "Utente" };
    const firebaseObject = window.firebase;
    payload.updatedAt = firebaseObject?.firestore?.FieldValue?.serverTimestamp ? firebaseObject.firestore.FieldValue.serverTimestamp() : new Date().toISOString();
    return payload;
  }

  function saveRatingToFirestore(id, rating) {
    const collection = syncState.firestoreEnabled ? firestoreCollection() : null;
    if (!collection) return;
    updateSyncStatus("Sincronizzazione in corso");
    collection.doc(String(id)).set(firestorePayload(id, rating), { merge: true }).then(() => { syncState.lastSave = new Date().toISOString(); updateSyncStatus("Ultimo salvataggio riuscito"); renderDebug(); }).catch((error) => { updateSyncStatus("Salvato offline, sincronizzazione non riuscita", error); renderDebug(); });
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

  function firstValue(source, fields) {
    return fields.map((field) => clean(source?.[field])).find(Boolean) || null;
  }

  function firstImageUrl(source, fields) {
    return firstValue(source, fields);
  }

  function teamLogoUrl(team) {
    return firstImageUrl(team, ["logoUrl", "logo", "crestUrl", "imageUrl", "badgeUrl", "emblemUrl"]);
  }

  function playerPortraitUrl(player) {
    return firstImageUrl(player, ["portraitUrl", "portrait", "imageUrl", "avatar", "photoUrl", "pictureUrl"]);
  }

  function normalizePlayerElement(value) {
    const normalized = key(value);
    if (!normalized) return null;
    if (["albero", "wood", "forest", "tree", "grass"].includes(normalized)) return "Albero";
    if (["fuoco", "fire", "flame"].includes(normalized)) return "Fuoco";
    if (["montagna", "mountain", "earth", "rock"].includes(normalized)) return "Montagna";
    if (["vento", "wind", "air"].includes(normalized)) return "Vento";
    return null;
  }

  function playerElement(player) {
    return normalizePlayerElement(firstValue(player, ["element", "type", "attribute", "nature", "affinity", "tipo", "elemento"]));
  }

  function ratedPlayerPayload(player) {
    const rating = normalizeRating(ratings[playerId(player)]); const overall = overallFor(player, rating);
    return { playerId: playerId(player), name: player.name || "", portraitUrl: playerPortraitUrl(player), position: player.position || player.role || "", element: playerElement(player), ...Object.fromEntries(STAT_DEFS.map(([stat]) => [stat, rating[stat]])), overall, category: categoryFor(overall) };
  }

  function selectedTeamExportPayload(team) {
    const ratedPlayers = playersForTeam(team).filter(isRated).map(ratedPlayerPayload);
    const overalls = ratedPlayers.map((player) => player.overall);
    const teamOverall = overalls.length ? Math.round(overalls.reduce((sum, value) => sum + value, 0) / overalls.length) : null;
    return { teamId: String(team.id ?? ""), teamName: team.name || "", logoUrl: teamLogoUrl(team), teamOverall, teamStars: starsFor(teamOverall), ratedPlayers: ratedPlayers.length, totalPlayers: playersForTeam(team).length, players: ratedPlayers };
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

  function startFirestoreSync() {
    refreshFirebaseDiagnostics();
    if (firestoreSyncStarted) { renderDebug(); return; }
    if (!syncState.firebaseSdkLoaded) { updateSyncStatus("Offline / solo localStorage", new Error("Firebase SDK non caricato")); renderDebug(); return; }
    if (!syncState.authAvailable) { updateSyncStatus("Offline / solo localStorage", new Error("Auth Firebase non disponibile")); renderDebug(); return; }
    if (!syncState.firestoreAvailable) { updateSyncStatus("Offline / solo localStorage", new Error("Firestore non disponibile")); renderDebug(); return; }
    firestoreSyncStarted = true;
    updateSyncStatus("Connessione Firestore...");
    const auth = window.INAZUMA_FIREBASE_AUTH;
    const connectFirestore = (user) => {
      syncState.authUid = user?.uid || auth.currentUser?.uid || "";
      syncState.authStatus = syncState.authUid ? "ok" : "ok / UID non disponibile";
      syncState.firestoreEnabled = true;
      updateSyncStatus("Firestore connesso");
      const collection = firestoreCollection();
      if (!collection) { syncState.firestoreEnabled = false; firestoreSyncStarted = false; updateSyncStatus("Errore sync", new Error("Firestore non disponibile")); renderDebug(); return; }
      collection.get().then((snapshot) => {
        let count = 0;
        snapshot.forEach((doc) => { count += 1; mergeRatingRecord(doc.id, doc.data()); });
        syncState.firestoreLoaded = count; persistRatings(); updateSyncStatus("Firestore connesso"); render();
      }).catch((error) => { updateSyncStatus("Errore sync", error); renderDebug(); });
      collection.onSnapshot((snapshot) => {
        syncState.listenerActive = true;
        let changed = false;
        snapshot.docChanges().forEach((change) => { if (change.type !== "removed") changed = mergeRatingRecord(change.doc.id, change.doc.data()) || changed; });
        syncState.firestoreLoaded = snapshot.size;
        updateSyncStatus("Firestore connesso");
        if (changed) { persistRatings(); render(); } else renderDebug();
      }, (error) => { syncState.listenerActive = false; updateSyncStatus("Errore sync", error); renderDebug(); });
    };
    if (auth.currentUser) { connectFirestore(auth.currentUser); return; }
    syncState.authStatus = "in attesa";
    auth.signInAnonymously().then((credential) => connectFirestore(credential?.user)).catch((error) => {
      syncState.firestoreEnabled = false; firestoreSyncStarted = false; syncState.authStatus = "errore";
      updateSyncStatus("Offline / solo localStorage", error); renderDebug();
    });
  }

  function uploadLocalRatingsToFirestore() {
    if (!syncState.firestoreEnabled || !firestoreCollection()) { updateSyncStatus("Firestore non connesso."); return; }
    if (!confirm("Questa operazione caricherà online i rating locali salvati nel browser. Assicurati di aver esportato un backup ratings.json.")) return;
    const localRatings = loadRatings();
    const ids = Object.keys(localRatings);
    updateSyncStatus("Sincronizzazione in corso");
    Promise.all(ids.map((id) => firestoreCollection().doc(id).set(firestorePayload(id, localRatings[id]), { merge: true })))
      .then(() => { updateSyncStatus(`Ultimo salvataggio riuscito: ${ids.length} rating caricati`); renderDebug(); })
      .catch((error) => { updateSyncStatus("Errore sync", error); renderDebug(); });
  }

  function importRatingsJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || "[]"));
        if (!Array.isArray(payload)) throw new Error("ratings.json deve contenere un array");
        let imported = 0; let existing = 0;
        payload.forEach((record) => {
          const id = String(record?.playerId || "");
          if (!id) return;
          if (ratings[id]) existing += 1;
          if (!ratings[id] || shouldUseIncoming(ratings[id], record) || (!timestampValue(ratings[id].updatedAt) && !timestampValue(record.updatedAt) && confirm(`Il rating del giocatore ${id} esiste già. Vuoi sovrascriverlo?`))) {
            ratings[id] = { ...normalizeRating(record), updatedAt: updatedAtString(record.updatedAt) || new Date().toISOString(), updatedBy: clean(record.updatedBy) || syncState.evaluatorName || "Utente" };
            imported += 1;
          }
        });
        persistRatings(); render(); updateSyncStatus(`Import completato: ${imported} rating importati, ${existing} già presenti. Alcuni rating erano già presenti. Sono stati mantenuti i più recenti dove possibile.`);
      } catch (error) { updateSyncStatus("Errore import ratings.json", error); renderDebug(); }
      if (nodes.importJson) nodes.importJson.value = "";
    };
    reader.readAsText(file);
  }

  function render() {
    if (!nodes.debug || !nodes.teams || !nodes.players) return;
    refreshFirebaseDiagnostics();
    if (!firestoreSyncStarted && syncState.authAvailable && syncState.firestoreAvailable) startFirestoreSync();
    updateSyncStatus(syncState.status);
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
  if (nodes.evaluatorName) { nodes.evaluatorName.value = syncState.evaluatorName; nodes.evaluatorName.addEventListener("input", () => { syncState.evaluatorName = nodes.evaluatorName.value.trim(); localStorage.setItem(EVALUATOR_KEY, syncState.evaluatorName); renderDebug(); }); }
  nodes.uploadFirestore?.addEventListener("click", uploadLocalRatingsToFirestore);
  nodes.importJson?.addEventListener("change", () => importRatingsJson(nodes.importJson.files && nodes.importJson.files[0]));
  startFirestoreSync();
  globalThis.InazumaPlayerRatings = { render, playersForTeam, overallFor, categoryFor, starsFor, exportRatingsJson, exportTeamsRatedJson, exportSelectedTeamsRatingsJson, startFirestoreSync };
})();
