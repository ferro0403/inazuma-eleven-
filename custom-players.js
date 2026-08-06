(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InazumaCustomPlayers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const STORAGE_KEY = "inazumaCustomPlayers";
  const RATINGS_KEY = "inazumaPlayerRatings";
  const VALID_POSITIONS = ["FW", "MF", "DF", "GK"];
  const VALID_ELEMENTS = ["Forest", "Fire", "Mountain", "Wind"];
  const RECOMMENDED_CUSTOM_BYTES = 1024 * 1024;
  const MAX_CUSTOM_STORAGE_BYTES = 4 * 1024 * 1024;
  let lastLoadError = null;

  const clean = (value) => String(value ?? "").trim();
  const key = (value) => clean(value).toLocaleLowerCase();
  const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];
  const officialPlayers = () => Array.isArray(root.INAZUMA_PLAYERS) ? root.INAZUMA_PLAYERS : [];
  const officialTeams = () => Array.isArray(root.INAZUMA_TEAMS) ? root.INAZUMA_TEAMS : [];
  const officialIds = () => new Set(officialPlayers().flatMap((player) => [player?.id, player?.playerId]).map(String).filter(Boolean));
  const teamLookupValues = (team) => unique([team?.id, team?.name, ...(Array.isArray(team?.aliases) ? team.aliases : [])]).map(key);
  const byteSize = (value) => new Blob([String(value ?? "")]).size;
  const isQuotaError = (error) => error?.name === "QuotaExceededError" || error?.name === "NS_ERROR_DOM_QUOTA_REACHED" || error?.code === 22 || error?.code === 1014;

  function customError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    error.cause = cause;
    return error;
  }

  function safeParseStorage(storage, storageKey, fallback) {
    try {
      const raw = storage?.getItem(storageKey);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      if (storageKey === STORAGE_KEY) lastLoadError = error;
      console.warn(`${storageKey} localStorage corrotto`, error);
      return fallback;
    }
  }

  function load(storage = root.localStorage) {
    lastLoadError = null;
    const parsed = safeParseStorage(storage, STORAGE_KEY, []);
    if (!Array.isArray(parsed)) {
      lastLoadError = new Error("Custom players storage is not an array");
      console.warn("Custom players localStorage corrotto", lastLoadError);
      return [];
    }
    try {
      return parsed.map(normalize).filter(Boolean);
    } catch (error) {
      lastLoadError = error;
      console.warn("Custom players localStorage corrotto", error);
      return [];
    }
  }

  function save(players, storage = root.localStorage) {
    const normalized = (Array.isArray(players) ? players : []).map((player) => normalize(player, { keepId: true, existing: [] })).filter(Boolean);
    let payload = "[]";
    try {
      payload = JSON.stringify(normalized);
    } catch (error) {
      throw customError("CUSTOM_PLAYERS_STRINGIFY", "Impossibile preparare i custom players per il salvataggio.", error);
    }
    const bytes = byteSize(payload);
    if (bytes > MAX_CUSTOM_STORAGE_BYTES) {
      throw customError("CUSTOM_PLAYERS_TOO_LARGE", "Dati custom troppo pesanti. Riduci le immagini o rimuovi alcuni custom players.");
    }
    try {
      storage?.setItem(STORAGE_KEY, payload);
    } catch (error) {
      if (isQuotaError(error)) throw customError("CUSTOM_PLAYERS_QUOTA", "Spazio locale pieno. Riduci l’immagine o carica una foto più leggera.", error);
      throw error;
    }
    return { ok: true, bytes, count: normalized.length, warning: bytes > RECOMMENDED_CUSTOM_BYTES };
  }

  function reset(storage = root.localStorage) { storage?.removeItem(STORAGE_KEY); }

  function nextId(existing = load()) {
    const used = new Set([...officialIds(), ...existing.flatMap((player) => [player.id, player.playerId]).map(String).filter(Boolean)]);
    let index = 1;
    let id = "custom_0001";
    while (used.has(id)) id = `custom_${String(++index).padStart(4, "0")}`;
    return id;
  }

  function normalize(raw = {}, options = {}) {
    const existing = Array.isArray(options.existing) ? options.existing : load();
    const idCandidate = clean(raw.id || raw.playerId);
    const id = options.keepId && idCandidate && !officialIds().has(idCandidate) ? idCandidate : (idCandidate && !officialIds().has(idCandidate) && !existing.some((player) => player.id === idCandidate) ? idCandidate : nextId(existing));
    const firstName = clean(raw.firstName || raw.givenName || raw.name).split(/\s+/)[0] || clean(raw.firstName || raw.name);
    const lastName = clean(raw.lastName || raw.surname);
    const displayName = clean(raw.displayName || raw.fullName || raw.name || [firstName, lastName].filter(Boolean).join(" "));
    const name = displayName || [firstName, lastName].filter(Boolean).join(" ");
    const position = VALID_POSITIONS.includes(clean(raw.position || raw.role).toUpperCase()) ? clean(raw.position || raw.role).toUpperCase() : "MF";
    const elementRaw = clean(raw.element || raw.type);
    const element = VALID_ELEMENTS.find((value) => key(value) === key(elementRaw)) || "Wind";
    if (!name) return null;
    const teamIds = unique([...(Array.isArray(raw.teamIds) ? raw.teamIds : []), ...(Array.isArray(raw.teams) ? raw.teams : [])]);
    const portraitUrl = clean(raw.portraitUrl || raw.portrait || raw.imageUrl || raw.avatar);
    const now = new Date().toISOString();
    return { id, playerId: id, name, firstName, lastName, displayName: name, position, role: position, element, type: element, portraitUrl, portrait: portraitUrl, imageUrl: portraitUrl, avatar: portraitUrl, teams: teamIds, teamIds, custom: true, source: "custom", notes: clean(raw.notes), createdAt: clean(raw.createdAt) || now, updatedAt: clean(raw.updatedAt) || now };
  }

  function allPlayers() { return [...officialPlayers(), ...load()]; }

  function playerTeamIds(player) { return unique([...(Array.isArray(player?.teamIds) ? player.teamIds : []), ...(Array.isArray(player?.teams) ? player.teams : [])]); }

  function isPlayerInTeam(player, team) {
    const ids = playerTeamIds(player).map(key);
    if (!ids.length || !team) return false;
    const values = new Set(teamLookupValues(team));
    return ids.some((id) => values.has(id));
  }

  function customPlayersForTeam(team, customPlayers = load()) { return customPlayers.filter((player) => isPlayerInTeam(player, team)); }

  function removeRating(playerIdValue, storage = root.localStorage) {
    try {
      const ratings = safeParseStorage(storage, RATINGS_KEY, {});
      if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) return;
      delete ratings[String(playerIdValue)];
      storage?.setItem(RATINGS_KEY, JSON.stringify(ratings));
    } catch { /* ignore corrupted ratings */ }
    const db = root.INAZUMA_FIRESTORE;
    const auth = root.INAZUMA_FIREBASE_AUTH;
    if (db && auth?.currentUser) db.collection("inazumaRatingProjects").doc("main").collection("ratings").doc(String(playerIdValue)).delete().catch(() => {});
  }

  function storageReport(storage = root.localStorage) {
    const keys = [];
    try { for (let index = 0; index < (storage?.length || 0); index += 1) keys.push(storage.key(index)); }
    catch (error) { console.warn("Impossibile leggere localStorage", error); }
    const entries = keys.filter(Boolean).map((storageKey) => {
      let value = "";
      try { value = storage.getItem(storageKey) || ""; } catch (error) { console.warn(`Impossibile leggere ${storageKey}`, error); }
      const bytes = byteSize(value);
      return { key: storageKey, bytes, kb: +(bytes / 1024).toFixed(2), mb: +(bytes / 1024 / 1024).toFixed(2), warning: bytes > 1024 * 1024 ? "over 1MB" : "" };
    });
    const customRaw = safeParseStorage(storage, STORAGE_KEY, []);
    const ratingsRaw = safeParseStorage(storage, RATINGS_KEY, {});
    return { entries, customPlayers: Array.isArray(customRaw) ? customRaw.length : 0, ratings: ratingsRaw && typeof ratingsRaw === "object" && !Array.isArray(ratingsRaw) ? Object.keys(ratingsRaw).length : 0, warnings: entries.filter((entry) => entry.bytes > 1024 * 1024).map((entry) => `${entry.key} supera 1MB`) };
  }

  function debugInazumaStorage(storage = root.localStorage) {
    const report = storageReport(storage);
    console.table(report.entries);
    console.info(`Custom players: ${report.customPlayers}`);
    console.info(`Rating locali: ${report.ratings}`);
    report.warnings.forEach((warning) => console.warn(warning));
    const customEntry = report.entries.find((entry) => entry.key === STORAGE_KEY);
    if (customEntry?.bytes > RECOMMENDED_CUSTOM_BYTES) console.warn("Custom players sopra la dimensione consigliata", customEntry);
    return report;
  }

  function resetInazumaCustomPlayersOnly(storage = root.localStorage) {
    const ok = typeof root.confirm === "function" ? root.confirm("Vuoi eliminare solo i giocatori personalizzati locali? I rating non verranno cancellati.") : true;
    if (!ok) return false;
    reset(storage);
    if (root.location?.reload) root.location.reload();
    return true;
  }

  root.debugInazumaStorage = debugInazumaStorage;
  root.resetInazumaCustomPlayersOnly = resetInazumaCustomPlayersOnly;

  return { STORAGE_KEY, VALID_POSITIONS, VALID_ELEMENTS, RECOMMENDED_CUSTOM_BYTES, MAX_CUSTOM_STORAGE_BYTES, lastLoadError: () => lastLoadError, load, save, reset, nextId, normalize, allPlayers, isPlayerInTeam, customPlayersForTeam, removeRating, storageReport, debugInazumaStorage, resetInazumaCustomPlayersOnly };
});
