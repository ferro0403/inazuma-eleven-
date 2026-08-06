(() => {
  "use strict";

  const officialPlayers = Array.isArray(globalThis.INAZUMA_PLAYERS) ? globalThis.INAZUMA_PLAYERS : [];
  const CustomPlayers = globalThis.InazumaCustomPlayers;
  let customPlayers = CustomPlayers?.load(localStorage) || [];
  let players = [...officialPlayers, ...customPlayers];
  const seedTeams = Array.isArray(globalThis.INAZUMA_TEAMS) ? globalThis.INAZUMA_TEAMS : [];
  const TeamStore = globalThis.InazumaTeamStore;
  const STORAGE_KEY = "inazumaPlayerRatings";
  const EVALUATOR_KEY = "inazumaPlayerRatingsEvaluator";
  const PENDING_SYNC_KEY = "inazumaPlayerRatingsPendingSync";
  const TEAM_ROLE_OVERRIDES_KEY = "inazumaPlayerRatingsTeamRoleOverrides";
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
  const VALID_ROLE_CODES = ["GK", "DF", "MF", "FW"];
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    debug: $("#ratings-debug"), progress: $("#ratings-progress"), teams: $("#ratings-team-list"), selectedTeam: $("#ratings-selected-team"), heading: $("#ratings-player-heading"), players: $("#ratings-player-list"), editor: $("#ratings-editor"),
    search: $("#ratings-player-search"), status: $("#ratings-status-filter"), toggleTeams: $("#ratings-toggle-teams"), exportRatings: $("#export-ratings"), exportTeams: $("#export-rated-teams"),
    exportTeamList: $("#ratings-export-team-list"), exportSelectAll: $("#ratings-export-select-all"), exportClear: $("#ratings-export-clear"), exportRatedOnly: $("#ratings-export-rated-only"), exportSelectedTeams: $("#export-selected-team-ratings"), importSelectedTeams: $("#import-selected-team-ratings"), exportFeedback: $("#ratings-export-feedback"),
    syncStatus: $("#ratings-sync-status"), syncCount: $("#ratings-sync-count"), evaluatorName: $("#ratings-evaluator-name"), importJson: $("#ratings-import-json"),
  };
  function loadTeamsForRatings() {
    const savedTeams = TeamStore?.load ? TeamStore.load(localStorage) : [];
    if (TeamStore?.hydrate) return TeamStore.hydrate(officialPlayers, seedTeams, savedTeams);
    return seedTeams;
  }

  let teams = loadTeamsForRatings();
  let playerById = new Map(players.map((player) => [String(player.id), player]));
  let selectedTeamId = teams[0]?.id || "";
  let selectedPlayerId = "";
  let editorDraft = null;
  let editorDraftPlayerId = "";
  let activeRoleVariantId = "";
  let playerSearch = "";
  let statusFilter = "all";
  let ratings = loadRatings();
  let pendingSync = loadPendingSync();
  let teamRoleOverrides = loadTeamRoleOverrides();
  let syncState = { status: "Offline / cache locale", firestoreEnabled: false, firestoreConnected: false, syncEnabled: false, firestoreLoaded: 0, authUid: "", lastError: "", lastSave: "", evaluatorName: localStorage.getItem(EVALUATOR_KEY) || "", firebaseSdkLoaded: false, firebaseReady: false, authAvailable: false, firestoreAvailable: false, authStatus: "in attesa", listenerActive: false, offlineCause: "", unsubscribeFirestore: null };
  let firestoreSyncStarted = false;
  let firestoreListenerStarting = false;
  let pendingFlushPromise = null;
  let initialFirestoreSnapshotHandled = false;
  let onlineHandlerBound = false;
  let completionMessage = "";
  let generatorMessage = "";
  let teamsCollapsed = false;
  let autoMinOverall = 65;
  let autoMaxOverall = 78;
  let autoReport = "";
  const selectedExportTeamIds = new Set();

  const clean = (value) => String(value ?? "").trim();
  const key = (value) => clean(value).toLocaleLowerCase();
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const clampStat = (value) => { const numeric = Number(value); return Math.max(1, Math.min(10, Number.isFinite(numeric) ? Math.round(numeric) : 5)); };
  const playerId = (player) => String(player?.id ?? "");

  function loadRatings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).map(([id, record]) => [id, normalizeRatingForPlayer(id, record)]));
    } catch { return {}; }
  }

  function persistRatings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
  }

  function loadPendingSync() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function persistPendingSync() {
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(pendingSync));
  }

  function loadTeamRoleOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TEAM_ROLE_OVERRIDES_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const normalized = {};
      Object.entries(parsed).forEach(([teamId, playersById]) => {
        if (!playersById || typeof playersById !== "object" || Array.isArray(playersById)) return;
        const cleanTeamId = String(teamId || "");
        const teamMap = {};
        Object.entries(playersById).forEach(([id, role]) => {
          const cleanRole = String(role || "").toUpperCase();
          if (VALID_ROLE_CODES.includes(cleanRole)) teamMap[String(id)] = cleanRole;
        });
        if (Object.keys(teamMap).length) normalized[cleanTeamId] = teamMap;
      });
      return normalized;
    } catch { return {}; }
  }

  function persistTeamRoleOverrides() {
    localStorage.setItem(TEAM_ROLE_OVERRIDES_KEY, JSON.stringify(teamRoleOverrides));
  }

  function teamKey(team) {
    return String(team?.id ?? "");
  }

  function refreshTeamsCache() {
    teams = loadTeamsForRatings();
    if (!teams.some((team) => team.id === selectedTeamId)) selectedTeamId = teams[0]?.id || "";
    [...selectedExportTeamIds].forEach((id) => { if (!teams.some((team) => team.id === id)) selectedExportTeamIds.delete(id); });
  }

  function queueRatingSync(id, operation = "set") {
    const playerIdValue = String(id || "");
    if (!playerIdValue) return;
    pendingSync[playerIdValue] = { operation: operation === "delete" ? "delete" : "set", queuedAt: new Date().toISOString() };
    persistPendingSync();
  }

  function queueRatingsSync(ids, operation = "set") {
    const normalizedOperation = operation === "delete" ? "delete" : "set";
    const queuedAt = new Date().toISOString();
    ids.forEach((id) => {
      const playerIdValue = String(id || "");
      if (playerIdValue) pendingSync[playerIdValue] = { operation: normalizedOperation, queuedAt };
    });
    persistPendingSync();
  }

  function pendingSyncCount() {
    return Object.keys(pendingSync).length;
  }

  function timestampValue(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function ratingTimestamp(record) {
    return Math.max(timestampValue(record?.updatedAt), timestampValue(record?.clientUpdatedAt));
  }

  function shouldUseIncoming(existing, incoming) {
    const existingTime = ratingTimestamp(existing);
    const incomingTime = ratingTimestamp(incoming);
    if (existingTime && incomingTime) return incomingTime >= existingTime;
    if (incomingTime && !existingTime) return true;
    if (!existingTime && !incomingTime && !existing) return true;
    return false;
  }

  function refreshPlayerCache() { customPlayers = CustomPlayers?.load(localStorage) || []; players = [...officialPlayers, ...customPlayers]; playerById = new Map(players.map((player) => [String(player.id), player])); }

  function mergeRatingRecord(playerIdValue, record) {
    const id = String(playerIdValue || record?.playerId || "");
    if (!id || !record || !playerById.has(id)) return false;
    const normalized = { ...record, ...normalizeRatingForPlayer(id, record) };
    normalized.playerId = id;
    if (record.updatedBy) normalized.updatedBy = clean(record.updatedBy);
    if (record.clientUpdatedAt) normalized.clientUpdatedAt = updatedAtString(record.clientUpdatedAt);
    const previous = ratings[id];
    if (shouldUseIncoming(previous, normalized)) {
      ratings[id] = normalized;
      return JSON.stringify(previous || null) !== JSON.stringify(normalized);
    }
    return false;
  }

  function mergeRemoteRatingRecord(playerIdValue, record) {
    const id = String(playerIdValue || record?.playerId || "");
    return pendingSync[id]?.operation === "set" ? false : mergeRatingRecord(id, record);
  }

  function syncClass(status) {
    const value = key(status);
    if (value.includes("connesso") || value.includes("riuscito") || value.includes("realtime") || value.includes("attiva")) return "ratings-sync-status--online";
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

  function currentFirestoreUser() {
    const auth = window.INAZUMA_FIREBASE_AUTH;
    return auth?.currentUser || null;
  }

  function canUseFirestore() {
    return Boolean(window.INAZUMA_FIRESTORE && currentFirestoreUser());
  }


  function refreshConnectedState() {
    refreshFirebaseDiagnostics();
    const user = currentFirestoreUser();
    syncState.authUid = user?.uid || syncState.authUid || "";
    syncState.firestoreConnected = Boolean(window.INAZUMA_FIREBASE_READY && window.INAZUMA_FIRESTORE && window.INAZUMA_FIREBASE_AUTH && user);
    syncState.syncEnabled = syncState.firestoreConnected;
    syncState.firestoreEnabled = syncState.firestoreConnected;
  }

  function updateSyncStatus(status, error) {
    refreshConnectedState();
    syncState.status = syncState.firestoreConnected && status.toLowerCase().includes("offline") ? "Sync realtime attiva" : status;
    if (error) { syncState.lastError = errorText(error); syncState.offlineCause = readableOfflineCause(error); }
    if (status.includes("Offline") && !syncState.offlineCause) syncState.offlineCause = readableOfflineCause(error);
    if (!error && (status.includes("connesso") || status.includes("riuscito") || status.includes("realtime") || status.includes("attiva"))) { syncState.lastError = ""; syncState.offlineCause = ""; }
    if (nodes.syncStatus) {
      nodes.syncStatus.textContent = `Stato sync: ${syncState.status}`;
      nodes.syncStatus.className = `ratings-sync-status ${syncClass(syncState.status)}`;
    }
    if (nodes.syncCount) nodes.syncCount.textContent = `Rating: ${Object.keys(ratings).length.toLocaleString()} · In attesa: ${pendingSyncCount().toLocaleString()}`;
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

  function variantIdForRole(role) { return VALID_ROLE_CODES.includes(String(role || "").toUpperCase()) ? String(role).toLowerCase() : "mf"; }

  function normalizeVariant(source = {}, fallbackRole = "MF") {
    const position = VALID_ROLE_CODES.includes(String(source.position || "").toUpperCase()) ? String(source.position).toUpperCase() : (VALID_ROLE_CODES.includes(fallbackRole) ? fallbackRole : "MF");
    const stats = { ...DEFAULT_STATS };
    STAT_DEFS.forEach(([stat]) => { stats[stat] = clampStat(source[stat]); });
    const overall = Number.isFinite(Number(source.overall)) ? clampOverall(source.overall) : overallForRole(position, stats);
    return { variantId: variantIdForRole(position), position, ...stats, overall, portraitUrl: clean(source.portraitUrl) || null, frontFullbodyUrl: clean(source.frontFullbodyUrl) || null, evaluated: source.evaluated === undefined ? Boolean(source.updatedAt) : Boolean(source.evaluated), updatedAt: updatedAtString(source.updatedAt) || "" };
  }

  function validVariant(variant) {
    return Boolean(variant?.evaluated && VALID_ROLE_CODES.includes(variant.position) && variant.variantId === variantIdForRole(variant.position) && Number.isFinite(Number(variant.overall)) && STAT_DEFS.every(([stat]) => Number.isFinite(Number(variant[stat])) && Number(variant[stat]) >= 1 && Number(variant[stat]) <= 10));
  }

  function normalizeRating(record = {}, fallbackRole = "MF") {
    const legacyRole = VALID_ROLE_CODES.includes(String(record.position || "").toUpperCase()) ? String(record.position).toUpperCase() : fallbackRole;
    const candidates = Array.isArray(record.roleVariants) && record.roleVariants.length ? record.roleVariants : [record];
    const seen = new Set();
    const roleVariants = candidates.slice(0, 2).map((variant) => normalizeVariant(variant, legacyRole)).filter((variant) => { if (seen.has(variant.variantId)) return false; seen.add(variant.variantId); return true; });
    if (!roleVariants.length) roleVariants.push(normalizeVariant(record, legacyRole));
    const requestedDefault = clean(record.defaultRoleVariantId).toLowerCase();
    const defaultRoleVariantId = roleVariants.some((variant) => variant.variantId === requestedDefault) ? requestedDefault : roleVariants[0].variantId;
    const defaultVariant = roleVariants.find((variant) => variant.variantId === defaultRoleVariantId);
    const roleSwitchEnabled = roleVariants.length === 2 && new Set(roleVariants.map((variant) => variant.position)).size === 2 && roleVariants.every(validVariant);
    const normalized = { ...defaultVariant, roleVariants, defaultRoleVariantId, roleSwitchEnabled, updatedAt: updatedAtString(record.updatedAt || defaultVariant.updatedAt) || "" };
    if (record.autoGenerated) normalized.autoGenerated = true;
    if (record.autoGeneratedAt) normalized.autoGeneratedAt = clean(record.autoGeneratedAt);
    if (record.autoGeneratedRange && typeof record.autoGeneratedRange === "object") normalized.autoGeneratedRange = record.autoGeneratedRange;
    if (record.generatedFromOverall) normalized.generatedFromOverall = true;
    return normalized;
  }

  function normalizeRatingForPlayer(playerIdValue, record = {}) {
    const player = playerById.get(String(playerIdValue));
    return normalizeRating(record, player ? originalRoleCode(player) : "MF");
  }

  function draftRating(player) {
    const saved = ratings[playerId(player)];
    const record = saved ? normalizeRating(saved, roleCode(player)) : normalizeRating({ position: roleCode(player), evaluated: false }, roleCode(player));
    const selected = record.roleVariants.find((variant) => variant.variantId === activeRoleVariantId) || record.roleVariants.find((variant) => variant.variantId === record.defaultRoleVariantId) || record.roleVariants[0];
    activeRoleVariantId = selected.variantId;
    return { ...selected };
  }

  function resetEditorDraft(player) {
    editorDraftPlayerId = playerId(player);
    editorDraft = { ...draftRating(player) };
    generatorMessage = "";
  }


  function resetEditorForPlayer(player) {
    activeRoleVariantId = "";
    editorDraft = null;
    editorDraftPlayerId = "";
    if (player) resetEditorDraft(player);
  }

  function currentEditorRating(player) {
    if (playerId(player) !== editorDraftPlayerId || !editorDraft) resetEditorDraft(player);
    return editorDraft;
  }

  function isRated(player) {
    const record = ratings[playerId(player)];
    return record ? normalizeRating(record, roleCode(player)).roleVariants.some((variant) => variant.evaluated) : false;
  }

  function originalRoleCode(player) {
    const value = key(`${player?.position || ""} ${player?.role || ""}`);
    if (value.includes("gk") || value.includes("por")) return "GK";
    if (value.includes("df") || value.includes("def")) return "DF";
    if (value.includes("fw") || value.includes("att")) return "FW";
    return "MF";
  }

  function teamRoleOverride(team, player) {
    const value = teamRoleOverrides[teamKey(team)]?.[playerId(player)];
    return VALID_ROLE_CODES.includes(value) ? value : "";
  }

  function setTeamRoleOverride(team, player, role) {
    const teamId = teamKey(team);
    const id = playerId(player);
    if (!teamId || !id) return;
    const cleanRole = String(role || "").toUpperCase();
    if (!teamRoleOverrides[teamId]) teamRoleOverrides[teamId] = {};
    if (VALID_ROLE_CODES.includes(cleanRole)) teamRoleOverrides[teamId][id] = cleanRole;
    else delete teamRoleOverrides[teamId][id];
    if (!Object.keys(teamRoleOverrides[teamId]).length) delete teamRoleOverrides[teamId];
    persistTeamRoleOverrides();
  }

  function contextPlayerForTeam(player, team) {
    const override = teamRoleOverride(team, player);
    if (!override) return player;
    return { ...player, __ratingsTeamRole: override, __ratingsOriginalRole: originalRoleCode(player), __ratingsTeamId: teamKey(team) };
  }

  function roleCode(player) {
    const override = String(player?.__ratingsTeamRole || "").toUpperCase();
    if (VALID_ROLE_CODES.includes(override)) return override;
    return originalRoleCode(player);
  }

  function overallFor(player, rating) {
    const normalized = rating?.roleVariants ? normalizeRating(rating, roleCode(player)) : null;
    const variant = normalized?.roleVariants.find((item) => item.variantId === normalized.defaultRoleVariantId) || rating;
    return overallForRole(variant?.position || roleCode(player), variant);
  }

  function overallForRole(role, rating) {
    const weights = ROLE_WEIGHTS[role] || ROLE_WEIGHTS.MF;
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


  function randomInt(min, max) {
    const low = Math.ceil(min); const high = Math.floor(max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
  }

  function clampOverall(value) {
    const numeric = Number(value);
    return Math.max(1, Math.min(99, Number.isFinite(numeric) ? Math.round(numeric) : 65));
  }

  function roleImportantStats(role) {
    if (role === "FW") return ["attack", "control", "physical", "speed", "stamina", "grit"];
    if (role === "DF") return ["defense", "physical", "grit", "stamina", "speed", "control"];
    if (role === "GK") return ["save", "grit", "physical", "defense", "control"];
    return ["control", "stamina", "grit", "speed", "attack", "defense", "physical"];
  }

  function roleArchetypeBoost(role) {
    const archetypes = {
      FW: [
        { attack: 2, control: 1 }, { attack: 1, speed: 2 }, { attack: 1, physical: 2 }, { attack: 1, control: 2 }, { attack: 1, grit: 2 },
      ],
      MF: [
        { control: 2, grit: 1 }, { control: 1, stamina: 2, grit: 1 }, { control: 2, speed: 1 }, { stamina: 2, grit: 2 }, { control: 1, attack: 1, defense: 1 },
      ],
      DF: [
        { defense: 2, grit: 1 }, { defense: 1, physical: 2 }, { defense: 1, speed: 2 }, { defense: 1, grit: 2 }, { defense: 3 },
      ],
      GK: [
        { save: 3 }, { save: 2, physical: 1 }, { save: 2, grit: 1 }, { save: 1, grit: 1, physical: 1, defense: 1 },
      ],
    };
    const list = archetypes[role] || archetypes.MF;
    return list[randomInt(0, list.length - 1)];
  }

  function enforceRoleRules(player, rawStats) {
    const role = roleCode(player);
    const stats = { ...DEFAULT_STATS, ...rawStats };
    STAT_DEFS.forEach(([stat]) => { stats[stat] = clampStat(stats[stat]); });
    if (role !== "GK") stats.save = 1;
    if (role === "FW") {
      stats.defense = Math.min(3, Math.max(1, stats.defense));
      stats.control = Math.max(4, stats.control);
    }
    if (role === "MF") {
      stats.control = Math.max(4, stats.control);
      stats.stamina = Math.max(4, stats.stamina);
      stats.defense = Math.max(3, stats.defense);
    }
    if (role === "DF") {
      stats.attack = Math.min(3, Math.max(1, stats.attack));
      stats.physical = Math.max(4, stats.physical);
      stats.grit = Math.max(4, stats.grit);
    }
    if (role === "GK") {
      stats.attack = Math.min(2, Math.max(1, stats.attack));
      stats.speed = Math.min(2, Math.max(1, stats.speed));
      stats.save = Math.max(4, stats.save);
    }
    STAT_DEFS.forEach(([stat]) => { stats[stat] = clampStat(stats[stat]); });
    return stats;
  }

  function isBalancedOverallBand(overall) { return overall >= 70 && overall <= 99; }

  function primaryStatForRole(role) {
    if (role === "FW") return "attack";
    if (role === "DF") return "defense";
    if (role === "GK") return "save";
    return "control";
  }

  function primaryValueForOverall(overall) {
    if (overall >= 85) return 9;
    if (overall >= 80) return 8;
    if (overall >= 70) return 7;
    return 6;
  }

  function primaryMaxForRoleAndOverall(role, overall) {
    const base = primaryValueForOverall(overall);
    // I portieri hanno save al 70% nel calcolo: a 78-79 è matematicamente
    // impossibile arrivare al target con save bloccata a 7. In quel caso
    // concediamo solo il minimo scatto necessario, senza permettere picchi a 9/10.
    if (role === "GK" && overall >= 78 && overall <= 79) return 8;
    return base;
  }

  function balancedBandMax(overall) {
    if (overall >= 80) return 9;
    if (overall >= 75) return 8;
    if (overall >= 70) return 7;
    return 8;
  }

  function statInRange([min, max]) { return randomInt(min, max); }

  function clampRange(value, [min, max]) { return Math.max(min, Math.min(max, clampStat(value))); }

  function balancedRangesForRole(role, targetOverall) {
    const main = primaryValueForOverall(targetOverall);
    if (main === 9) {
      if (targetOverall < 90) {
        return {
          FW: { attack: [9, 9], control: [7, 9], speed: [7, 9], physical: [7, 9], stamina: [7, 9], grit: [7, 9], defense: [1, 3], save: [1, 1] },
          MF: { attack: [6, 8], physical: [6, 8], stamina: [7, 9], control: [9, 9], defense: [6, 8], speed: [7, 9], grit: [7, 9], save: [1, 1] },
          DF: { attack: [1, 3], physical: [7, 9], stamina: [7, 9], control: [5, 8], defense: [9, 9], speed: [7, 9], grit: [7, 9], save: [1, 1] },
          GK: { attack: [1, 2], physical: [6, 8], stamina: [4, 6], control: [4, 6], defense: [6, 8], speed: [1, 2], grit: [7, 9], save: [9, 9] },
        }[role] || { attack: [6, 8], physical: [6, 8], stamina: [7, 9], control: [9, 9], defense: [6, 8], speed: [7, 9], grit: [7, 9], save: [1, 1] };
      }
      return {
        FW: { attack: [9, 9], control: [8, 9], speed: [7, 9], physical: [7, 9], stamina: [7, 9], grit: [7, 9], defense: [1, 3], save: [1, 1] },
        MF: { attack: [7, 9], physical: [7, 9], stamina: [8, 9], control: [9, 9], defense: [6, 8], speed: [7, 9], grit: [8, 9], save: [1, 1] },
        DF: { attack: [1, 3], physical: [8, 9], stamina: [7, 9], control: [6, 9], defense: [9, 9], speed: [7, 9], grit: [8, 9], save: [1, 1] },
        GK: { attack: [1, 2], physical: [7, 9], stamina: [5, 9], control: [5, 9], defense: [7, 9], speed: [1, 2], grit: [8, 9], save: [9, 9] },
      }[role] || { attack: [7, 9], physical: [7, 9], stamina: [8, 9], control: [9, 9], defense: [6, 8], speed: [7, 9], grit: [8, 9], save: [1, 1] };
    }
    if (main === 8) {
      if (targetOverall >= 85) {
        return {
          FW: { attack: [8, 8], control: [8, 9], speed: [7, 9], physical: [7, 9], stamina: [7, 9], grit: [7, 9], defense: [1, 3], save: [1, 1] },
          MF: { attack: [7, 8], physical: [7, 9], stamina: [8, 9], control: [8, 8], defense: [6, 8], speed: [7, 9], grit: [8, 9], save: [1, 1] },
          DF: { attack: [1, 3], physical: [8, 9], stamina: [7, 9], control: [6, 8], defense: [8, 8], speed: [7, 9], grit: [8, 9], save: [1, 1] },
          GK: { attack: [1, 2], physical: [7, 9], stamina: [5, 7], control: [5, 7], defense: [7, 9], speed: [1, 2], grit: [8, 9], save: [8, 8] },
        }[role] || { attack: [7, 8], physical: [7, 9], stamina: [8, 9], control: [8, 8], defense: [6, 8], speed: [7, 9], grit: [8, 9], save: [1, 1] };
      }
      if (targetOverall >= 83) {
        return {
          FW: { attack: [8, 8], control: [7, 9], speed: [6, 9], physical: [6, 9], stamina: [6, 9], grit: [6, 9], defense: [1, 3], save: [1, 1] },
          MF: { attack: [6, 8], physical: [6, 9], stamina: [7, 9], control: [8, 8], defense: [5, 8], speed: [6, 9], grit: [7, 9], save: [1, 1] },
          DF: { attack: [1, 3], physical: [7, 9], stamina: [6, 9], control: [5, 8], defense: [8, 8], speed: [6, 9], grit: [7, 9], save: [1, 1] },
          GK: { attack: [1, 2], physical: [6, 9], stamina: [4, 7], control: [4, 7], defense: [6, 9], speed: [1, 2], grit: [7, 9], save: [8, 8] },
        }[role] || { attack: [6, 8], physical: [6, 9], stamina: [7, 9], control: [8, 8], defense: [5, 8], speed: [6, 9], grit: [7, 9], save: [1, 1] };
      }
      return {
        FW: { attack: [8, 8], control: [7, 8], speed: [6, 8], physical: [6, 8], stamina: [6, 8], grit: [6, 8], defense: [1, 3], save: [1, 1] },
        MF: { attack: [6, 8], physical: [6, 8], stamina: [7, 8], control: [8, 8], defense: [5, 7], speed: [6, 8], grit: [7, 8], save: [1, 1] },
        DF: { attack: [1, 3], physical: [7, 8], stamina: [6, 8], control: [5, 7], defense: [8, 8], speed: [6, 8], grit: [7, 8], save: [1, 1] },
        GK: { attack: [1, 2], physical: [6, 8], stamina: [4, 6], control: [4, 6], defense: [6, 8], speed: [1, 2], grit: [7, 8], save: [8, 8] },
      }[role] || { attack: [6, 8], physical: [6, 8], stamina: [7, 8], control: [8, 8], defense: [5, 7], speed: [6, 8], grit: [7, 8], save: [1, 1] };
    }
    if (targetOverall >= 75) {
      return {
        FW: { attack: [7, 7], control: [7, 8], speed: [6, 8], physical: [6, 8], stamina: [6, 8], grit: [6, 8], defense: [1, 3], save: [1, 1] },
        MF: { attack: [6, 8], physical: [6, 8], stamina: [7, 8], control: [7, 7], defense: [5, 7], speed: [6, 8], grit: [7, 8], save: [1, 1] },
        DF: { attack: [1, 3], physical: [7, 8], stamina: [6, 8], control: [5, 7], defense: [7, 7], speed: [6, 8], grit: [7, 8], save: [1, 1] },
        GK: { attack: [1, 2], physical: [6, 8], stamina: [4, 6], control: [4, 6], defense: [6, 8], speed: [1, 2], grit: [7, 8], save: [7, primaryMaxForRoleAndOverall(role, targetOverall)] },
      }[role] || { attack: [6, 8], physical: [6, 8], stamina: [7, 8], control: [7, 7], defense: [5, 7], speed: [6, 8], grit: [7, 8], save: [1, 1] };
    }
    return {
      FW: { attack: [7, 7], control: [6, 7], speed: [5, 7], physical: [5, 7], stamina: [5, 7], grit: [5, 7], defense: [1, 3], save: [1, 1] },
      MF: { attack: [5, 7], physical: [5, 7], stamina: [6, 7], control: [7, 7], defense: [4, 6], speed: [5, 7], grit: [6, 7], save: [1, 1] },
      DF: { attack: [1, 3], physical: [6, 7], stamina: [5, 7], control: [4, 6], defense: [7, 7], speed: [5, 7], grit: [6, 7], save: [1, 1] },
      GK: { attack: [1, 2], physical: [5, 7], stamina: [3, 5], control: [3, 5], defense: [5, 7], speed: [1, 2], grit: [6, 7], save: [7, 7] },
    }[role] || { attack: [5, 7], physical: [5, 7], stamina: [6, 7], control: [7, 7], defense: [4, 6], speed: [5, 7], grit: [6, 7], save: [1, 1] };
  }

  function balancedRangeStats(player, targetOverall) {
    if (!isBalancedOverallBand(targetOverall)) return null;
    const role = roleCode(player);
    const primary = primaryStatForRole(role);
    const ranges = balancedRangesForRole(role, targetOverall);
    const stats = Object.fromEntries(STAT_DEFS.map(([stat]) => [stat, statInRange(ranges[stat]) ]));
    stats[primary] = primaryValueForOverall(targetOverall);

    const variants = {
      FW: ["tecnico", "veloce", "fisico", "resistente", "grintoso"],
      MF: ["regista", "box-to-box", "fisico", "difensivo", "equilibrato"],
      DF: ["marcatore", "fisico", "veloce", "grintoso", "pulito"],
      GK: ["riflessi", "fisico", "grintoso", "equilibrato"],
    };
    const variant = (variants[role] || variants.MF)[randomInt(0, (variants[role] || variants.MF).length - 1)];
    const boost = (stat, delta) => { stats[stat] = clampRange(stats[stat] + delta, ranges[stat]); };

    if (role === "FW") {
      if (variant === "tecnico") boost("control", 1);
      if (variant === "veloce") boost("speed", 1);
      if (variant === "fisico") boost("physical", 1);
      if (variant === "resistente") boost("stamina", 1);
      if (variant === "grintoso") boost("grit", 1);
      stats.defense = clampRange(stats.defense, ranges.defense);
    }
    if (role === "MF") {
      if (variant === "regista") boost("stamina", 1);
      if (variant === "box-to-box") { boost("stamina", 1); boost("grit", 1); }
      if (variant === "fisico") boost("physical", 1);
      if (variant === "difensivo") boost("defense", 1);
      if (variant === "equilibrato") { boost("speed", 1); boost("attack", 1); }
    }
    if (role === "DF") {
      if (variant === "marcatore") boost("grit", 1);
      if (variant === "fisico") boost("physical", 1);
      if (variant === "veloce") boost("speed", 1);
      if (variant === "grintoso") { boost("grit", 1); boost("stamina", 1); }
      if (variant === "pulito") boost("control", 1);
      stats.attack = clampRange(stats.attack, ranges.attack);
    }
    if (role === "GK") {
      if (variant === "fisico") boost("physical", 1);
      if (variant === "grintoso") boost("grit", 1);
      if (variant === "equilibrato") { boost("defense", 1); boost("control", 1); }
      stats.attack = statInRange(ranges.attack);
      stats.speed = statInRange(ranges.speed);
    }

    stats[primary] = primaryValueForOverall(targetOverall);
    return enforceRoleRules(player, stats);
  }

  function usefulSpread(stats, fields) {
    const values = fields.map((field) => stats[field]);
    return Math.max(...values) - Math.min(...values);
  }

  function balancedProfileViolation(player, stats, targetOverall) {
    if (!isBalancedOverallBand(targetOverall)) return 0;
    const role = roleCode(player);
    const primary = primaryStatForRole(role);
    const primaryValue = primaryValueForOverall(targetOverall);
    const primaryMax = primaryMaxForRoleAndOverall(role, targetOverall);
    const maxValue = balancedBandMax(targetOverall);
    if (stats[primary] < primaryValue || stats[primary] > primaryMax) return Infinity;
    if (Object.values(stats).some((value) => value > maxValue || value >= 10)) return Infinity;
    if (role !== "GK" && stats.save !== 1) return Infinity;
    if (role === "FW" && (stats.defense > 3 || usefulSpread(stats, ["attack", "control", "speed", "physical", "stamina", "grit"]) > 2)) return Infinity;
    if (role === "MF" && (stats.save !== 1 || stats.attack > stats.control || usefulSpread(stats, ["attack", "physical", "stamina", "control", "speed", "grit"]) > 2 || usefulSpread(stats, ["attack", "physical", "stamina", "control", "defense", "speed", "grit"]) > 3)) return Infinity;
    if (role === "DF" && (stats.attack > 3 || usefulSpread(stats, ["physical", "stamina", "defense", "speed", "grit"]) > 2 || usefulSpread(stats, ["physical", "stamina", "control", "defense", "speed", "grit"]) > 3)) return Infinity;
    if (role === "GK" && (stats.attack > 2 || stats.speed > 2 || usefulSpread(stats, ["physical", "defense", "grit", "save"]) > 2 || usefulSpread(stats, ["physical", "stamina", "control", "defense", "grit", "save"]) > 4)) return Infinity;
    return 0;
  }

  function balancedProfilePenalty(player, stats, targetOverall) {
    const role = roleCode(player);
    const weightedFields = roleImportantStats(role).filter((stat) => !(role !== "GK" && stat === "save"));
    const weightedValues = weightedFields.map((stat) => stats[stat]);
    const spread = weightedValues.length ? Math.max(...weightedValues) - Math.min(...weightedValues) : 0;
    const rolePenalty = role === "GK" ? usefulSpread(stats, ["physical", "defense", "grit", "save"]) : spread;
    const primary = primaryStatForRole(role);
    const maxValue = balancedBandMax(targetOverall);
    const nearCapPenalty = Object.values(stats).filter((value) => value === maxValue).length * 0.08;
    const primaryRelaxPenalty = Math.max(0, stats[primary] - primaryValueForOverall(targetOverall)) * 0.5;
    return (rolePenalty * 0.35) + nearCapPenalty + primaryRelaxPenalty;
  }

  function candidateStats(player, targetOverall = 75) {
    const balanced = balancedRangeStats(player, targetOverall);
    if (balanced) return balanced;
    const role = roleCode(player);
    const important = roleImportantStats(role);
    const boost = roleArchetypeBoost(role);
    const stats = Object.fromEntries(STAT_DEFS.map(([stat]) => [stat, randomInt(2, 7)]));
    important.forEach((stat, index) => { stats[stat] += Math.max(0, 3 - Math.floor(index / 2)); });
    Object.entries(boost).forEach(([stat, value]) => { stats[stat] = (stats[stat] || 1) + value; });
    STAT_DEFS.forEach(([stat]) => { stats[stat] += randomInt(-2, 2); });
    if (role === "FW") stats.attack = Math.max(stats.attack, stats.control, stats.speed, stats.physical, stats.grit);
    if (role === "MF") stats.control = Math.max(stats.control, stats.stamina, stats.grit);
    if (role === "DF") stats.defense = Math.max(stats.defense, stats.physical, stats.grit);
    if (role === "GK") { stats.attack = randomInt(1, 2); stats.speed = Math.random() < 0.85 ? 1 : 2; stats.save = Math.max(stats.save, stats.grit + 2, stats.physical + 2, stats.defense + 1); }
    return enforceRoleRules(player, stats);
  }

  function enumerateBalancedCandidates(player, targetOverall, min, max) {
    if (!isBalancedOverallBand(targetOverall)) return null;
    const role = roleCode(player);
    const ranges = balancedRangesForRole(role, targetOverall);
    const statsKeys = STAT_DEFS.map(([stat]) => stat);
    let best = null;
    let bestScore = Infinity;

    function visit(index, current) {
      if (index >= statsKeys.length) {
        const stats = enforceRoleRules(player, current);
        const violation = balancedProfileViolation(player, stats, targetOverall);
        if (!Number.isFinite(violation)) return;
        const overall = overallFor(player, stats);
        const rangePenalty = overall < min ? min - overall : overall > max ? overall - max : 0;
        const exactRangeBonus = overall >= min && overall <= max ? -3 : 0;
        const score = violation + (rangePenalty * 30) + Math.abs(overall - targetOverall) + balancedProfilePenalty(player, stats, targetOverall) + exactRangeBonus;
        if (score < bestScore) { best = { stats, overall }; bestScore = score; }
        return;
      }
      const stat = statsKeys[index];
      const [low, high] = ranges[stat] || [1, 10];
      for (let value = low; value <= high; value += 1) {
        current[stat] = value;
        visit(index + 1, current);
      }
    }

    visit(0, {});
    return best;
  }

  function closestStatsForOverall(player, targetOverall, options = {}) {
    const min = options.min ?? targetOverall;
    const max = options.max ?? targetOverall;
    const attempts = options.attempts ?? 500;
    let best = null;
    let bestScore = Infinity;
    const enumerated = enumerateBalancedCandidates(player, targetOverall, min, max);
    if (enumerated && enumerated.overall >= min && enumerated.overall <= max) return enumerated;
    if (enumerated) { best = enumerated; bestScore = Math.abs(enumerated.overall - targetOverall) + balancedProfilePenalty(player, enumerated.stats, targetOverall); }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const stats = candidateStats(player, targetOverall);
      const violation = balancedProfileViolation(player, stats, targetOverall);
      if (!Number.isFinite(violation)) continue;
      const overall = overallFor(player, stats);
      const rangePenalty = overall < min ? min - overall : overall > max ? overall - max : 0;
      const score = violation + (rangePenalty * 20) + Math.abs(overall - targetOverall) + balancedProfilePenalty(player, stats, targetOverall) + (Math.random() * 0.05);
      if (score < bestScore) { best = { stats, overall }; bestScore = score; }
      if (overall === targetOverall && overall >= min && overall <= max) return best;
    }
    if (!best && isBalancedOverallBand(targetOverall)) {
      const stats = balancedRangeStats(player, targetOverall);
      return stats ? { stats, overall: overallFor(player, stats) } : null;
    }
    return best;
  }

  function autoTeamCounts(team = selectedTeam()) {
    const roster = team ? playersForTeam(team) : [];
    const rated = roster.filter(isRated).length;
    return { total: roster.length, rated, unrated: roster.length - rated };
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
    const official = Array.isArray(team?.playerIds) ? team.playerIds.map((id) => playerById.get(String(id))).filter(Boolean) : (() => { const linked = linkedByTeamPlayers(team); return linked.length ? linked : linkedByPlayerFields(team); })();
    const custom = CustomPlayers?.customPlayersForTeam(team, customPlayers) || [];
    return unique([...official, ...custom].map((player) => player.id)).map((id) => [...official, ...custom].find((player) => player.id === id)).filter(Boolean).sort((a, b) => collator.compare(a.name, b.name));
  }

  function selectedTeam() {
    return teams.find((team) => team.id === selectedTeamId) || teams[0];
  }

  function contextualRosterForTeam(team) {
    return playersForTeam(team).map((player) => contextPlayerForTeam(player, team));
  }

  function selectedRoster() {
    return contextualRosterForTeam(selectedTeam());
  }

  function filteredRoster() {
    const needle = playerSearch.toLocaleLowerCase();
    return selectedRoster().filter((player) => (!needle || key(player.name).includes(needle)) && (statusFilter === "all" || (statusFilter === "rated" ? isRated(player) : !isRated(player))));
  }

  function teamSummary(team) {
    const roster = contextualRosterForTeam(team);
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
      stat("currentUser UID", currentFirestoreUser()?.uid || "—"),
      stat("firestoreConnected", String(syncState.firestoreConnected)),
      stat("syncEnabled", String(syncState.syncEnabled)),
      stat("Scritture locali in attesa", pendingSyncCount().toLocaleString()),
      stat("Path condiviso", FIRESTORE_PROJECT_PATH),
      stat("Login anonimo", syncState.authStatus),
      stat("UID utente anonimo", syncState.authUid || "—"),
      stat("Listener Firestore", syncState.listenerActive ? "attivo" : "non attivo"),
      stat("Rating in localStorage", Object.keys(loadRatings()).length.toLocaleString()),
      stat("Rating caricati da Firestore", syncState.firestoreLoaded.toLocaleString()),
      stat("Ultima scrittura Firestore", syncState.lastSave || "—"),
      stat("Ultimo errore sync", syncState.lastError || syncState.offlineCause || "—"),
      stat("Fonte dati giocatori", "globalThis.INAZUMA_PLAYERS + localStorage inazumaCustomPlayers"), stat("Fonte dati squadre", "Team Manager + globalThis.INAZUMA_TEAMS"),
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
      button.addEventListener("click", () => { selectedTeamId = team.id; selectedPlayerId = ""; resetEditorForPlayer(null); completionMessage = ""; teamsCollapsed = true; render(); });
      fragment.append(button);
    });
    nodes.teams.replaceChildren(fragment);
  }

  function ratingBadge(player) {
    const badge = document.createElement("span"); badge.className = `ratings-badge ${isRated(player) ? "ratings-badge--rated" : ""}`;
    badge.textContent = isRated(player) ? "Valutato" : "Non valutato"; if (ratings[playerId(player)]?.autoGenerated) { const auto = document.createElement("span"); auto.className = "ratings-auto-badge"; auto.textContent = "AUTO"; badge.append(" ", auto); } return badge;
  }

  function playerRow(player) {
    const rated = isRated(player); const record = ratings[playerId(player)] ? normalizeRating(ratings[playerId(player)], roleCode(player)) : null; const rating = record || normalizeRating({ position: roleCode(player) }, roleCode(player)); const overall = overallFor(player, rating); const category = categoryFor(overall);
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
    nodes.selectedTeam.append(renderTeamRatingsTools(team), renderAutoEvaluatePanel(team));
  }

  function renderTeamRatingsTools(team) {
    const summary = teamSummary(team);
    const panel = document.createElement("section"); panel.className = "ratings-team-tools";
    const title = document.createElement("strong"); title.textContent = "Gestione rating squadra";
    const help = document.createElement("small"); help.textContent = "Rimuove solo le valutazioni salvate dei giocatori di questa squadra. Non elimina giocatori, squadre o custom players.";
    const removeAll = document.createElement("button"); removeAll.type = "button"; removeAll.className = "button button--danger ratings-clear-team"; removeAll.textContent = "Togli rating a tutta la squadra"; removeAll.disabled = summary.ratedPlayers === 0;
    removeAll.addEventListener("click", () => clearRatingsForTeam(team));
    panel.append(title, help, removeAll);
    return panel;
  }

  function clearRatingsForTeam(team) {
    const roster = contextualRosterForTeam(team);
    const ids = unique(roster.map(playerId).filter((id) => ratings[id]));
    if (!ids.length) { autoReport = "Questa squadra non ha rating da rimuovere."; render(); return; }
    const confirmed = confirm(`Rimuovere i rating salvati di ${ids.length} giocatori della squadra ${team.name || team.id}?

L’operazione verrà sincronizzata su Firestore. Gli altri rating non verranno toccati.`);
    if (!confirmed) return;
    ids.forEach((id) => { delete ratings[id]; });
    persistRatings();
    queueRatingsSync(ids, "delete");
    if (ids.includes(selectedPlayerId)) { selectedPlayerId = ""; resetEditorForPlayer(null); }
    autoReport = `Rating rimossi per ${ids.length} giocatori della squadra ${team.name || team.id}.`;
    updateSyncStatus(canUseFirestore() ? "Rimozione rating squadra in sincronizzazione" : "Rating squadra rimossi localmente · sync in attesa");
    void flushPendingSync();
    render();
  }


  function renderAutoEvaluatePanel(team) {
    const counts = autoTeamCounts(team);
    const panel = document.createElement("section"); panel.className = "ratings-auto-panel";
    const title = document.createElement("h4"); title.textContent = "Auto-valuta squadra";
    const mode = document.createElement("small"); mode.textContent = "Salvataggio locale immediato e sincronizzazione Firestore automatica.";
    const fields = document.createElement("div"); fields.className = "ratings-auto-fields";
    const minLabel = document.createElement("label"); minLabel.innerHTML = "<span>Overall minimo</span>";
    const minInput = document.createElement("input"); minInput.type = "number"; minInput.min = "1"; minInput.max = "99"; minInput.value = autoMinOverall; minInput.addEventListener("input", () => { autoMinOverall = clampOverall(minInput.value); }); minLabel.append(minInput);
    const maxLabel = document.createElement("label"); maxLabel.innerHTML = "<span>Overall massimo</span>";
    const maxInput = document.createElement("input"); maxInput.type = "number"; maxInput.min = "1"; maxInput.max = "99"; maxInput.value = autoMaxOverall; maxInput.addEventListener("input", () => { autoMaxOverall = clampOverall(maxInput.value); }); maxLabel.append(maxInput);
    const run = document.createElement("button"); run.type = "button"; run.className = "button"; run.textContent = "Auto-valuta non valutati"; run.disabled = counts.unrated === 0; run.addEventListener("click", () => autoEvaluateSelectedTeam());
    fields.append(minLabel, maxLabel, run);
    const summary = document.createElement("p"); summary.className = "ratings-auto-summary"; summary.textContent = `Totali ${counts.total} · Valutati ${counts.rated} · Da generare ${counts.unrated}`;
    const report = document.createElement("p"); report.className = "ratings-auto-report"; report.textContent = autoReport || (counts.unrated ? "Solo non valutati. Le modifiche vengono sincronizzate automaticamente." : "Non ci sono giocatori non valutati in questa squadra.");
    panel.append(title, mode, fields, summary, report);
    return panel;
  }

  function autoEvaluateSelectedTeam() {
    const team = selectedTeam(); if (!team) return;
    const min = clampOverall(autoMinOverall); const max = clampOverall(autoMaxOverall);
    autoMinOverall = min; autoMaxOverall = max;
    if (min > max) { autoReport = "Errore: overall minimo maggiore del massimo."; render(); return; }
    const roster = contextualRosterForTeam(team); const unrated = roster.filter((player) => !isRated(player)); const skipped = roster.length - unrated.length;
    if (!unrated.length) { autoReport = "Non ci sono giocatori non valutati in questa squadra."; render(); return; }
    const confirmed = confirm(`Stai per generare rating automatici per ${unrated.length} giocatori non valutati della squadra ${team.name || team.id}. I giocatori già valutati non verranno modificati. I nuovi rating verranno sincronizzati automaticamente su Firestore. Continuare?`);
    if (!confirmed) return;
    const now = new Date().toISOString();
    unrated.forEach((player) => {
      const targetOverall = randomInt(min, max);
      const generated = closestStatsForOverall(player, targetOverall, { min, max, attempts: 100 });
      const stats = enforceRoleRules(player, generated?.stats || DEFAULT_STATS);
      const overall = overallFor(player, stats);
      ratings[playerId(player)] = { ...normalizeRating({ playerId: playerId(player), position: roleCode(player), ...stats, overall, evaluated: true, updatedAt: now }, roleCode(player)), playerId: playerId(player), autoGenerated: true, autoGeneratedAt: now, autoGeneratedRange: { min, max }, updatedAt: now, updatedBy: syncState.evaluatorName || "Auto-valuta" };
    });
    persistRatings();
    queueRatingsSync(unrated.map((player) => playerId(player)), "set");
    void flushPendingSync();
    autoReport = `Auto-valutazione completata: Generati ${unrated.length}. Saltati già valutati ${skipped}. Range usato: ${min}-${max}. Salvati localmente e messi in sincronizzazione automatica.`;
    updateSyncStatus(syncState.firestoreEnabled ? "Sync realtime attiva" : "Salvato localmente · sync in attesa");
    render();
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
    const now = new Date().toISOString();
    const existing = normalizeRating(ratings[id] || { position: rating.position || roleCode(player) }, roleCode(player));
    const savedVariant = normalizeVariant({ ...rating, overall: overallForRole(rating.position, rating), evaluated: true, updatedAt: now }, rating.position);
    const draftVariantId = clean(rating?.variantId).toLowerCase();
    const roleVariants = existing.roleVariants.map((variant) => variant.variantId === draftVariantId ? savedVariant : variant);
    if (!roleVariants.some((variant) => variant.variantId === savedVariant.variantId)) roleVariants.push(savedVariant);
    ratings[id] = { ...normalizeRating({ ...existing, roleVariants, defaultRoleVariantId: existing.defaultRoleVariantId, updatedAt: now }), playerId: id, autoGenerated: false, generatedFromOverall: Boolean(rating.generatedFromOverall), updatedAt: now, clientUpdatedAt: now, updatedBy: syncState.evaluatorName || "Utente" };
    activeRoleVariantId = savedVariant.variantId;
    persistRatings();
    queueRatingSync(id, "set");
    updateSyncStatus(canUseFirestore() ? "Sincronizzazione in corso" : "Salvato localmente · sync in attesa");
    void flushPendingSync();
  }

  function firestorePayload(id, rating) {
    const normalized = normalizeRating(rating, originalRoleCode(playerById.get(String(id))));
    const calculatedOverall = normalized.overall;
    const payload = {
      playerId: String(id),
      position: normalized.position,
      evaluated: normalized.evaluated,
      ...Object.fromEntries(STAT_DEFS.map(([stat]) => [stat, normalized[stat]])),
      overall: calculatedOverall,
      category: categoryFor(calculatedOverall),
      defaultRoleVariantId: normalized.defaultRoleVariantId,
      roleSwitchEnabled: normalized.roleSwitchEnabled,
      roleVariants: normalized.roleVariants,
      updatedBy: clean(rating?.updatedBy) || syncState.evaluatorName || "Utente",
      clientUpdatedAt: updatedAtString(rating?.clientUpdatedAt || rating?.updatedAt) || new Date().toISOString(),
    };
    if (rating?.autoGenerated) payload.autoGenerated = true;
    if (rating?.autoGeneratedAt) payload.autoGeneratedAt = clean(rating.autoGeneratedAt);
    if (rating?.autoGeneratedRange) payload.autoGeneratedRange = rating.autoGeneratedRange;
    if (rating?.generatedFromOverall) payload.generatedFromOverall = true;
    const firebaseObject = window.firebase;
    payload.updatedAt = firebaseObject?.firestore?.FieldValue?.serverTimestamp ? firebaseObject.firestore.FieldValue.serverTimestamp() : new Date().toISOString();
    return payload;
  }


  function openPlayer(player) {
    selectedPlayerId = playerId(player); completionMessage = ""; resetEditorForPlayer(player); renderEditor(player); renderPlayers(); renderDebug(); renderProgress(); renderTeams();
  }

  function activeVariantPlayer(player, rating) { return { ...player, __ratingsTeamRole: rating.position }; }

  function addRoleVariant(player, role) {
    const id = playerId(player); const record = normalizeRating(ratings[id] || { position: roleCode(player) }, roleCode(player));
    if (record.roleVariants.length >= 2 || record.roleVariants.some((variant) => variant.position === role)) return;
    const variant = normalizeVariant({ position: role, evaluated: false }, role);
    ratings[id] = { ...normalizeRating({ ...record, roleVariants: [...record.roleVariants, variant] }), playerId: id };
    activeRoleVariantId = variant.variantId; resetEditorDraft(player); persistRatings(); queueRatingSync(id, "set"); void flushPendingSync(); render();
  }

  function setDefaultVariant(player, variantId) {
    const id = playerId(player); const record = normalizeRating(ratings[id], roleCode(player));
    ratings[id] = { ...normalizeRating({ ...record, defaultRoleVariantId: variantId }), playerId: id, updatedAt: new Date().toISOString() };
    persistRatings(); queueRatingSync(id, "set"); void flushPendingSync(); render();
  }

  function changeActiveVariantRole(player, role) {
    const id = playerId(player); const record = normalizeRating(ratings[id], roleCode(player));
    if (!VALID_ROLE_CODES.includes(role) || record.roleVariants.some((variant) => variant.variantId !== activeRoleVariantId && variant.position === role)) return;
    const previousId = activeRoleVariantId; const replacement = normalizeVariant({ ...currentEditorRating(player), position: role, variantId: variantIdForRole(role), overall: overallForRole(role, currentEditorRating(player)) }, role);
    const roleVariants = record.roleVariants.map((variant) => variant.variantId === previousId ? replacement : variant);
    activeRoleVariantId = replacement.variantId;
    ratings[id] = { ...normalizeRating({ ...record, roleVariants, defaultRoleVariantId: record.defaultRoleVariantId === previousId ? activeRoleVariantId : record.defaultRoleVariantId }), playerId: id };
    resetEditorDraft(player); persistRatings(); queueRatingSync(id, "set"); void flushPendingSync(); render();
  }

  function deleteActiveVariant(player) {
    const id = playerId(player); const record = normalizeRating(ratings[id], roleCode(player));
    if (record.roleVariants.length < 2 || !confirm(`Eliminare la variante ${activeRoleVariantId.toUpperCase()}?`)) return;
    const roleVariants = record.roleVariants.filter((variant) => variant.variantId !== activeRoleVariantId);
    activeRoleVariantId = roleVariants[0].variantId;
    ratings[id] = { ...normalizeRating({ ...record, roleVariants, defaultRoleVariantId: activeRoleVariantId }), playerId: id, updatedAt: new Date().toISOString() };
    resetEditorDraft(player); persistRatings(); queueRatingSync(id, "set"); void flushPendingSync(); render();
  }

  function renderTeamRoleOverridePanel(player, team) {
    const rawPlayer = playerById.get(playerId(player)) || player;
    const originalRole = originalRoleCode(rawPlayer);
    const override = teamRoleOverride(team, rawPlayer);
    const effectiveRole = override || originalRole;
    const panel = document.createElement("section"); panel.className = "ratings-role-override-panel";
    const text = document.createElement("div"); text.className = "ratings-role-override-panel__text";
    const title = document.createElement("strong"); title.textContent = "Ruolo per questa squadra";
    const help = document.createElement("small"); help.textContent = override ? `In questa valutazione usa ${effectiveRole}. Nel database resta ${originalRole}.` : `Usa il ruolo originale ${originalRole}.`;
    text.append(title, help);
    const label = document.createElement("label"); label.className = "ratings-role-override-select"; label.innerHTML = "<span>Cambia ruolo</span>";
    const select = document.createElement("select");
    select.append(new Option(`Originale (${originalRole})`, ""));
    VALID_ROLE_CODES.forEach((role) => select.append(new Option(role, role)));
    select.value = override || "";
    select.addEventListener("change", () => {
      setTeamRoleOverride(team, rawPlayer, select.value);
      const refreshed = contextPlayerForTeam(rawPlayer, team);
      completionMessage = ""; generatorMessage = "";
      renderEditor(refreshed); renderPlayers(); renderTeams(); renderSelectedTeamBar(); renderSelectedTeamsExport(); renderDebug();
    });
    label.append(select); panel.append(text, label); return panel;
  }

  function renderEditor(player = contextPlayerForTeam(playerById.get(selectedPlayerId), selectedTeam())) {
    if (!player) { nodes.editor.hidden = true; nodes.editor.replaceChildren(); return; }
    const team = selectedTeam(); const rating = currentEditorRating(player); const variantPlayer = activeVariantPlayer(player, rating); const overall = overallFor(variantPlayer, rating); const category = categoryFor(overall); const rated = Boolean(rating.evaluated);
    const record = normalizeRating(ratings[playerId(player)] || { position: rating.position }, roleCode(player));
    nodes.editor.hidden = false;
    const card = document.createElement("article"); card.className = "ratings-editor-card";
    const header = document.createElement("header");
    header.append(imageOrPlaceholder(player.imageUrl || player.portraitUrl, `${player.name} portrait`, player.name, "ratings-editor-card__portrait"));
    const info = document.createElement("div"); info.className = "ratings-editor-card__info"; const name = document.createElement("h3"); name.textContent = player.name || "Unnamed player";
    const meta = document.createElement("div"); meta.className = "ratings-editor-meta";
    [`ID ${player.id ?? "—"}`, `Variante ${rating.position}`, team?.name || "—", rated ? "Valutata" : "Non valutata"].forEach((value) => meta.append(Object.assign(document.createElement("span"), { textContent: value })));
    const score = document.createElement("p"); score.className = "ratings-editor-card__score"; score.textContent = `OVR ${overall} · ${category}`;
    info.append(name, meta, score); header.append(info); card.append(header);
    card.append(renderTeamRoleOverridePanel(player, team));
    const variantsPanel = document.createElement("section"); variantsPanel.className = "ratings-variants-panel";
    const tabs = document.createElement("div"); tabs.className = "ratings-variant-tabs";
    record.roleVariants.forEach((variant) => {
      const tab = document.createElement("button"); tab.type = "button"; tab.className = "button button--quiet ratings-variant-tab"; tab.classList.toggle("is-active", variant.variantId === activeRoleVariantId);
      tab.textContent = `${variant.position}${record.defaultRoleVariantId === variant.variantId ? " · PREDEFINITA" : ""}`;
      tab.addEventListener("click", () => { activeRoleVariantId = variant.variantId; resetEditorDraft(player); renderEditor(player); }); tabs.append(tab);
    });
    variantsPanel.append(tabs);
    if (record.roleVariants.length === 1) {
      const addWrap = document.createElement("div"); addWrap.className = "ratings-add-variant";
      const roleSelect = document.createElement("select"); VALID_ROLE_CODES.filter((role) => role !== record.roleVariants[0].position).forEach((role) => roleSelect.append(new Option(role, role)));
      const add = document.createElement("button"); add.type = "button"; add.className = "button button--quiet"; add.textContent = "AGGIUNGI SECONDO RUOLO"; add.addEventListener("click", () => addRoleVariant(player, roleSelect.value)); addWrap.append(roleSelect, add); variantsPanel.append(addWrap);
    } else {
      const variantActions = document.createElement("div"); variantActions.className = "ratings-variant-actions";
      const otherRole = record.roleVariants.find((variant) => variant.variantId !== activeRoleVariantId)?.position;
      const roleSelect = document.createElement("select"); VALID_ROLE_CODES.filter((role) => role !== otherRole).forEach((role) => roleSelect.append(new Option(role, role))); roleSelect.value = rating.position; roleSelect.setAttribute("aria-label", "Ruolo della variante"); roleSelect.addEventListener("change", () => changeActiveVariantRole(player, roleSelect.value));
      const makeDefault = document.createElement("button"); makeDefault.type = "button"; makeDefault.className = "button button--quiet"; makeDefault.textContent = record.defaultRoleVariantId === activeRoleVariantId ? "VARIANTE PREDEFINITA" : "IMPOSTA COME PREDEFINITA"; makeDefault.disabled = record.defaultRoleVariantId === activeRoleVariantId; makeDefault.addEventListener("click", () => setDefaultVariant(player, activeRoleVariantId));
      const removeVariant = document.createElement("button"); removeVariant.type = "button"; removeVariant.className = "button button--danger"; removeVariant.textContent = "ELIMINA VARIANTE"; removeVariant.addEventListener("click", () => deleteActiveVariant(player)); variantActions.append(makeDefault, removeVariant); variantsPanel.append(variantActions);
      variantActions.prepend(roleSelect);
    }
    const visuals = document.createElement("details"); visuals.className = "ratings-variant-visuals"; visuals.append(Object.assign(document.createElement("summary"), { textContent: "GRAFICA ALTERNATIVA" }));
    [["portraitUrl", "Portrait URL"], ["frontFullbodyUrl", "Front fullbody URL"]].forEach(([field, labelText]) => { const label = document.createElement("label"); label.textContent = labelText; const input = document.createElement("input"); input.type = "url"; input.placeholder = "https://…"; input.value = rating[field] || ""; input.addEventListener("input", () => { rating[field] = clean(input.value) || null; editorDraft = { ...rating }; }); label.append(input); visuals.append(label); });
    variantsPanel.append(visuals); card.append(variantsPanel);
    const controls = document.createElement("div"); controls.className = "ratings-stat-grid";
    STAT_DEFS.forEach(([stat, label]) => {
      const row = document.createElement("div"); row.className = "ratings-stat-control";
      const title = document.createElement("strong"); title.textContent = label;
      const minus = document.createElement("button"); minus.type = "button"; minus.textContent = "-";
      const value = document.createElement("span"); value.textContent = rating[stat];
      const plus = document.createElement("button"); plus.type = "button"; plus.textContent = "+";
      const change = (delta) => { rating[stat] = clampStat(Number(rating[stat]) + delta); rating.autoGenerated = false; editorDraft = { ...rating }; renderEditor(player); };
      minus.addEventListener("click", () => change(-1)); plus.addEventListener("click", () => change(1));
      row.append(title, minus, value, plus); controls.append(row);
    });
    const generator = document.createElement("section"); generator.className = "ratings-generate-panel";
    const generatorTitle = document.createElement("strong"); generatorTitle.textContent = "Genera OVR";
    const generatorControls = document.createElement("div"); generatorControls.className = "ratings-generate-controls";
    const targetLabel = document.createElement("label"); targetLabel.innerHTML = "<span>OVR</span>";
    const targetInput = document.createElement("input"); targetInput.type = "number"; targetInput.min = "1"; targetInput.max = "99"; targetInput.value = overall;
    targetLabel.append(targetInput);
    const generateButton = document.createElement("button"); generateButton.type = "button"; generateButton.className = "button button--quiet"; generateButton.textContent = "Genera";
    generateButton.addEventListener("click", () => generateStatsForEditor(variantPlayer, targetInput.value));
    generatorControls.append(targetLabel, generateButton);
    const generatorHelp = document.createElement("p"); generatorHelp.className = "ratings-generate-message"; generatorHelp.textContent = generatorMessage || `Attuale ${overall}. Non salva finché non premi Salva.`;
    generator.append(generatorTitle, generatorControls, generatorHelp);
    card.append(generator);
    const actions = document.createElement("div"); actions.className = "ratings-editor-actions";
    const previousPlayer = document.createElement("button"); previousPlayer.type = "button"; previousPlayer.className = "button button--quiet"; previousPlayer.textContent = "← Precedente"; previousPlayer.disabled = !adjacentPlayer(player, -1); previousPlayer.addEventListener("click", () => navigatePlayer(player, -1));
    const next = document.createElement("button"); next.type = "button"; next.className = "button ratings-save-next"; next.textContent = "SALVA E PROSSIMO"; next.addEventListener("click", () => saveAndNext(player));
    const nextPlayer = document.createElement("button"); nextPlayer.type = "button"; nextPlayer.className = "button button--quiet"; nextPlayer.textContent = "Successivo →"; nextPlayer.disabled = !adjacentPlayer(player, 1); nextPlayer.addEventListener("click", () => navigatePlayer(player, 1));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button--danger ratings-remove-rating"; remove.textContent = "Rimuovi valutazione"; remove.disabled = !rated; remove.title = rated ? "Rimuovi la valutazione salvata" : "Nessuna valutazione salvata da rimuovere"; remove.addEventListener("click", () => removeRating(player));
    const back = document.createElement("button"); back.type = "button"; back.className = "button button--quiet"; back.textContent = "Torna alla squadra"; back.addEventListener("click", () => { selectedPlayerId = ""; resetEditorForPlayer(null); completionMessage = ""; render(); });
    actions.append(previousPlayer, next, nextPlayer, remove, back); card.append(controls, actions);
    if (completionMessage) card.append(Object.assign(document.createElement("p"), { className: "ratings-complete", textContent: completionMessage }));
    nodes.editor.replaceChildren(card);
  }


  function generateStatsForEditor(player, targetValue) {
    const target = clampOverall(targetValue);
    const generated = closestStatsForOverall(player, target, { attempts: 600 });
    if (!generated) return;
    const stats = enforceRoleRules(player, generated.stats);
    const actual = overallFor(player, stats);
    editorDraftPlayerId = playerId(player);
    const current = currentEditorRating(player);
    editorDraft = { ...current, ...stats, overall: actual, autoGenerated: false, generatedFromOverall: true };
    generatorMessage = actual === target ? `Stats generate: overall ${actual}. Premi Salva e prossimo per salvare la valutazione.` : `Stats generate: overall ${actual}, più vicino possibile a ${target}. Premi Salva e prossimo per salvare la valutazione.`;
    renderEditor(player);
  }

  function adjacentPlayer(player, direction) {
    const roster = filteredRoster();
    const index = roster.findIndex((item) => playerId(item) === playerId(player));
    return index >= 0 ? roster[index + direction] : null;
  }

  function navigatePlayer(player, direction) {
    const target = adjacentPlayer(player, direction);
    if (!target) return;
    selectedPlayerId = playerId(target);
    completionMessage = "";
    resetEditorForPlayer(target);
    render();
  }

  function removeRating(player) {
    const id = playerId(player);
    if (!ratings[id]) return;
    const record = normalizeRating(ratings[id], roleCode(player));
    if (record.roleVariants.length === 2) {
      const removeAll = confirm("OK: rimuovi tutte le varianti.\nAnnulla: rimuovi soltanto la variante attiva.");
      if (!removeAll) { deleteActiveVariant(player); return; }
    } else if (!confirm("Vuoi rimuovere la valutazione di questo giocatore?")) return;
    delete ratings[id];
    persistRatings();
    resetEditorDraft(player);
    queueRatingSync(id, "delete");
    void flushPendingSync();
    render();
  }

  function saveAndNext(player) {
    saveRating(player, currentEditorRating(player));
    const roster = selectedRoster(); const index = roster.findIndex((item) => playerId(item) === playerId(player)); const next = roster[index + 1];
    if (next) { selectedPlayerId = playerId(next); completionMessage = ""; resetEditorForPlayer(next); render(); renderEditor(next); }
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

  // Keep playerElement available for official export contracts; custom players may also expose element directly.
  // element: playerElement
  function ratedPlayerPayload(player) {
    const rating = normalizeRating(ratings[playerId(player)], roleCode(player)); const overall = rating.overall;
    const originalRole = originalRoleCode(player);
    return { playerId: playerId(player), id: playerId(player), name: player.name || "", portraitUrl: playerPortraitUrl(player), position: rating.position, originalPosition: player.__ratingsTeamRole ? originalRole : undefined, ratingRole: rating.position, element: player.element || playerElement(player), type: player.type || player.element || playerElement(player), teamIds: Array.isArray(player.teamIds) ? player.teamIds : [], teams: Array.isArray(player.teams) ? player.teams : [], custom: Boolean(player.custom), ...Object.fromEntries(STAT_DEFS.map(([stat]) => [stat, rating[stat]])), overall, category: categoryFor(overall), defaultRoleVariantId: rating.defaultRoleVariantId, roleSwitchEnabled: rating.roleSwitchEnabled, roleVariants: rating.roleVariants };
  }

  function selectedTeamExportPayload(team) {
    const ratedPlayers = contextualRosterForTeam(team).filter(isRated).map(ratedPlayerPayload);
    const overalls = ratedPlayers.map((player) => player.overall);
    const teamOverall = overalls.length ? Math.round(overalls.reduce((sum, value) => sum + value, 0) / overalls.length) : null;
    return { teamId: String(team.id ?? ""), teamName: team.name || "", logoUrl: teamLogoUrl(team), teamOverall, teamStars: starsFor(teamOverall), ratedPlayers: ratedPlayers.length, totalPlayers: playersForTeam(team).length, players: ratedPlayers };
  }

  function exportRatingsJson() {
    const payload = players.filter(isRated).map((player) => {
      const rating = normalizeRating(ratings[playerId(player)], originalRoleCode(player)); const overall = rating.overall;
      return { playerId: playerId(player), id: playerId(player), name: player.name || "", position: rating.position, element: player.element || playerElement(player), type: player.type || player.element || playerElement(player), portraitUrl: playerPortraitUrl(player), teamIds: Array.isArray(player.teamIds) ? player.teamIds : [], teams: Array.isArray(player.teams) ? player.teams : [], custom: Boolean(player.custom), ...Object.fromEntries(STAT_DEFS.map(([stat]) => [stat, rating[stat]])), overall, category: categoryFor(overall), defaultRoleVariantId: rating.defaultRoleVariantId, roleSwitchEnabled: rating.roleSwitchEnabled, roleVariants: rating.roleVariants };
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
    const incomplete = payload.flatMap((team) => team.players.filter((player) => player.roleVariants.length === 2 && !player.roleSwitchEnabled).map((player) => player.name));
    if (incomplete.length) alert(`Varianti incomplete (cambio ruolo disabilitato): ${unique(incomplete).join(", ")}`);
    const exportedPlayers = payload.reduce((sum, team) => sum + team.players.length, 0);
    const zeroRated = payload.some((team) => team.players.length === 0);
    download("selected-teams-ratings.json", JSON.stringify(payload, null, 2));
    if (nodes.exportFeedback) nodes.exportFeedback.textContent = `Export creato: ${payload.length} squadre, ${exportedPlayers} giocatori valutati.${zeroRated ? " Alcune squadre selezionate non hanno giocatori valutati." : ""}`;
  }


  function normalizeSelectedTeamsImportPayload(payload) {
    const source = Array.isArray(payload) ? payload : Array.isArray(payload?.teams) ? payload.teams : [payload];
    const records = [];
    source.forEach((teamEntry) => {
      const teamName = clean(teamEntry?.teamName || teamEntry?.name || teamEntry?.id || teamEntry?.teamId || "Squadra importata");
      const playersList = Array.isArray(teamEntry?.players) ? teamEntry.players : Array.isArray(teamEntry?.ratings) ? teamEntry.ratings : [];
      playersList.forEach((record) => records.push({ ...record, importedTeamName: teamName }));
    });
    return records;
  }

  function importSelectedTeamsRatingsJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || "[]"));
        const records = normalizeSelectedTeamsImportPayload(payload);
        if (!records.length) throw new Error("Il file non contiene giocatori valutati nel formato Export squadre selezionate.");

        const valid = [];
        let ignored = 0;
        records.forEach((record) => {
          const id = String(record?.playerId || record?.id || "");
          if (!id || !playerById.has(id)) { ignored += 1; return; }
          valid.push({ id, record });
        });
        if (!valid.length) throw new Error("Nessun playerId del file corrisponde ai giocatori presenti nel database.");

        const teamsInFile = new Set(records.map((record) => clean(record.importedTeamName)).filter(Boolean));
        const message = `Importare ${valid.length} rating da ${teamsInFile.size || 1} squadre?\n\nI rating esistenti degli stessi giocatori verranno aggiornati. Gli altri rating locali NON verranno cancellati. Le modifiche verranno sincronizzate su Firestore realtime appena possibile.`;
        if (!confirm(message)) return;

        const now = new Date().toISOString();
        let imported = 0;
        valid.forEach(({ id, record }) => {
          ratings[id] = {
            ...normalizeRatingForPlayer(id, record),
            playerId: id,
            autoGenerated: Boolean(record.autoGenerated),
            generatedFromOverall: Boolean(record.generatedFromOverall),
            updatedAt: updatedAtString(record.updatedAt) || now,
            clientUpdatedAt: now,
            updatedBy: clean(record.updatedBy) || syncState.evaluatorName || "Import squadre",
          };
          queueRatingSync(id, "set");
          imported += 1;
        });

        selectedPlayerId = playerById.has(selectedPlayerId) ? selectedPlayerId : "";
        resetEditorForPlayer(null); completionMessage = ""; generatorMessage = "";
        persistRatings();
        render();
        updateSyncStatus(`Import squadre completato: ${imported} rating importati, ${ignored} ignorati. Sincronizzazione Firestore in corso.`);
        void flushPendingSync();
      } catch (error) {
        updateSyncStatus("Errore import squadre", error);
        renderDebug();
      }
      if (nodes.importSelectedTeams) nodes.importSelectedTeams.value = "";
    };
    reader.readAsText(file);
  }

  function scheduleRealtimeRender() {
    if (scheduleRealtimeRender.pending) return;
    scheduleRealtimeRender.pending = true;
    requestAnimationFrame(() => {
      scheduleRealtimeRender.pending = false;
      const selected = playerById.get(String(selectedPlayerId));
      resetEditorForPlayer(selected || null);
      persistRatings();
      render();
    });
  }

  async function flushPendingSync() {
    if (pendingFlushPromise) return pendingFlushPromise;
    const db = window.INAZUMA_FIRESTORE;
    const collection = canUseFirestore() ? firestoreCollection() : null;
    if (!db || !collection || !pendingSyncCount()) {
      if (pendingSyncCount()) updateSyncStatus("Salvato localmente · sync in attesa");
      return null;
    }

    const snapshotOfQueue = Object.entries(pendingSync).map(([id, entry]) => [id, { ...entry }]);
    pendingFlushPromise = (async () => {
      try {
        updateSyncStatus("Sincronizzazione in corso");
        for (let offset = 0; offset < snapshotOfQueue.length; offset += 400) {
          const chunk = snapshotOfQueue.slice(offset, offset + 400);
          const batch = db.batch();
          chunk.forEach(([id, entry]) => {
            const ref = collection.doc(String(id));
            if (entry.operation === "delete") batch.delete(ref);
            else if (ratings[id]) batch.set(ref, firestorePayload(id, ratings[id]), { merge: true });
          });
          await batch.commit();
          chunk.forEach(([id, entry]) => {
            const current = pendingSync[id];
            if (current && current.operation === entry.operation && current.queuedAt === entry.queuedAt) delete pendingSync[id];
          });
          persistPendingSync();
        }
        syncState.lastSave = `Ultima sincronizzazione: ok (${snapshotOfQueue.length} modifiche)`;
        updateSyncStatus("Sync realtime attiva");
        renderDebug();
      } catch (error) {
        updateSyncStatus("Salvato localmente · sincronizzazione non riuscita", error);
        renderDebug();
      } finally {
        pendingFlushPromise = null;
        if (pendingSyncCount() && canUseFirestore()) setTimeout(() => { void flushPendingSync(); }, 1200);
      }
    })();
    return pendingFlushPromise;
  }

  function attachFirestoreListener(user) {
    if (!user || syncState.listenerActive || firestoreListenerStarting) return;
    const collection = firestoreCollection();
    if (!collection) {
      firestoreSyncStarted = false;
      updateSyncStatus("Errore sync", new Error("Firestore non disponibile"));
      return;
    }

    firestoreListenerStarting = true;
    syncState.authUid = user.uid || "";
    syncState.authStatus = "ok";
    syncState.firestoreConnected = true;
    syncState.syncEnabled = true;
    syncState.firestoreEnabled = true;
    firestoreSyncStarted = true;
    updateSyncStatus("Connessione realtime...");

    syncState.unsubscribeFirestore = collection.onSnapshot((snapshot) => {
      syncState.listenerActive = true;
      firestoreListenerStarting = false;
      syncState.firestoreLoaded = snapshot.size;
      let changed = false;

      if (!initialFirestoreSnapshotHandled) {
        const localBeforeRemote = { ...ratings };
        const remoteIds = new Set();
        snapshot.forEach((doc) => {
          const id = String(doc.id);
          remoteIds.add(id);
          changed = mergeRemoteRatingRecord(id, doc.data()) || changed;
        });

        Object.keys(localBeforeRemote).forEach((id) => {
          if (!playerById.has(String(id)) || remoteIds.has(String(id))) return;
          ratings[id] = localBeforeRemote[id];
          queueRatingSync(id, "set");
          changed = true;
        });
        initialFirestoreSnapshotHandled = true;
      } else {
        snapshot.docChanges().forEach((change) => {
          const id = String(change.doc.id);
          if (!playerById.has(id)) return;
          if (change.type === "removed") {
            if (!pendingSync[id]) {
              delete ratings[id];
              changed = true;
            }
            return;
          }
          if (pendingSync[id]?.operation === "set" && !change.doc.metadata?.hasPendingWrites) return;
          changed = mergeRemoteRatingRecord(id, change.doc.data()) || changed;
        });
      }

      updateSyncStatus(snapshot.metadata?.fromCache ? "Sync realtime attiva · cache" : "Sync realtime attiva");
      if (changed) scheduleRealtimeRender();
      else renderDebug();
      void flushPendingSync();
    }, (error) => {
      syncState.listenerActive = false;
      firestoreListenerStarting = false;
      syncState.firestoreConnected = false;
      syncState.syncEnabled = false;
      syncState.firestoreEnabled = false;
      firestoreSyncStarted = false;
      updateSyncStatus("Errore sync realtime", error);
      renderDebug();
    });
  }

  function startFirestoreSync() {
    refreshConnectedState();
    if (syncState.listenerActive || firestoreListenerStarting) return;
    if (!syncState.firebaseSdkLoaded) { updateSyncStatus("Offline / cache locale", new Error("Firebase SDK non caricato")); renderDebug(); return; }
    if (!syncState.authAvailable) { updateSyncStatus("Offline / cache locale", new Error("Auth Firebase non disponibile")); renderDebug(); return; }
    if (!syncState.firestoreAvailable) { updateSyncStatus("Offline / cache locale", new Error("Firestore non disponibile")); renderDebug(); return; }

    if (!onlineHandlerBound) {
      onlineHandlerBound = true;
      window.addEventListener("online", () => { startFirestoreSync(); void flushPendingSync(); });
    }

    const auth = window.INAZUMA_FIREBASE_AUTH;
    if (auth.currentUser) {
      attachFirestoreListener(auth.currentUser);
      return;
    }

    if (firestoreSyncStarted) return;
    firestoreSyncStarted = true;
    syncState.authStatus = "in attesa";
    updateSyncStatus("Connessione Firestore...");
    auth.signInAnonymously()
      .then((credential) => attachFirestoreListener(credential?.user || auth.currentUser))
      .catch((error) => {
        syncState.firestoreConnected = false;
        syncState.syncEnabled = false;
        syncState.firestoreEnabled = false;
        firestoreSyncStarted = false;
        firestoreListenerStarting = false;
        syncState.authStatus = "errore";
        updateSyncStatus("Offline / cache locale", error);
        renderDebug();
      });
  }

  function importRatingsJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || "[]"));
        if (!Array.isArray(payload)) throw new Error("ratings.json deve contenere un array");
        const previousCount = Object.keys(ratings).length;
        if (!confirm("Vuoi sostituire i rating attuali con quelli del file importato? I giocatori non presenti nel file torneranno non valutati. Il file importato resta locale finché non modifichi e salvi i singoli rating.")) {
          if (nodes.importJson) nodes.importJson.value = "";
          return;
        }
        const replacement = {};
        let imported = 0; let ignored = 0;
        payload.forEach((record) => {
          const id = String(record?.playerId || record?.id || "");
          if (!id || !playerById.has(id)) { ignored += 1; return; }
          replacement[id] = { ...record, ...normalizeRatingForPlayer(id, record), updatedAt: updatedAtString(record.updatedAt) || new Date().toISOString(), updatedBy: clean(record.updatedBy) || syncState.evaluatorName || "Import" };
          imported += 1;
        });
        ratings = replacement;
        selectedPlayerId = playerById.has(selectedPlayerId) ? selectedPlayerId : "";
        resetEditorForPlayer(null); completionMessage = ""; generatorMessage = "";
        persistRatings();
        render();
        updateSyncStatus(`Import locale completato: Rating importati: ${imported}. Rating ignorati: ${ignored}. Rating precedenti rimossi: ${previousCount}. Firestore condiviso non viene sostituito in massa dall’import.`);
      } catch (error) { updateSyncStatus("Errore import ratings.json", error); renderDebug(); }
      if (nodes.importJson) nodes.importJson.value = "";
    };
    reader.readAsText(file);
  }


  function render() {
    refreshPlayerCache();
    refreshTeamsCache();
    if (!nodes.debug || !nodes.teams || !nodes.players) return;
    refreshFirebaseDiagnostics();
    if ((!firestoreSyncStarted || !syncState.firestoreConnected) && syncState.authAvailable && syncState.firestoreAvailable) startFirestoreSync();
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
  nodes.importSelectedTeams?.addEventListener("change", () => importSelectedTeamsRatingsJson(nodes.importSelectedTeams.files && nodes.importSelectedTeams.files[0]));
  if (nodes.evaluatorName) { nodes.evaluatorName.value = syncState.evaluatorName; nodes.evaluatorName.addEventListener("input", () => { syncState.evaluatorName = nodes.evaluatorName.value.trim(); localStorage.setItem(EVALUATOR_KEY, syncState.evaluatorName); renderDebug(); }); }
  nodes.importJson?.addEventListener("change", () => importRatingsJson(nodes.importJson.files && nodes.importJson.files[0]));
  startFirestoreSync();
  const testing = globalThis.INAZUMA_RATINGS_TEST_MODE ? {
    normalizeRatingForPlayer,
    mergeRatingRecord,
    mergeRemoteRatingRecord,
    shouldUseIncoming,
    firestorePayload,
    resetEditorForPlayer,
    saveRating,
    selectVariant: (player, variantId) => { activeRoleVariantId = variantId; resetEditorDraft(player); },
    state: () => ({ ratings, activeRoleVariantId, editorDraft: editorDraft ? { ...editorDraft } : null }),
    setRatings: (value) => { ratings = value; },
    setPendingSync: (value) => { pendingSync = value; },
  } : undefined;
  globalThis.InazumaPlayerRatings = { render, refresh: render, playersForTeam, overallFor, categoryFor, starsFor, exportRatingsJson, exportTeamsRatedJson, exportSelectedTeamsRatingsJson, startFirestoreSync, flushPendingSync, ...(testing ? { __testing: testing } : {}) };
})();
