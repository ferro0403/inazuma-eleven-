(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InazumaCustomPlayers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const STORAGE_KEY = "inazumaCustomPlayers";
  const VALID_POSITIONS = ["FW", "MF", "DF", "GK"];
  const VALID_ELEMENTS = ["Forest", "Fire", "Mountain", "Wind"];
  const clean = (value) => String(value ?? "").trim();
  const key = (value) => clean(value).toLocaleLowerCase();
  const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];
  const officialPlayers = () => Array.isArray(root.INAZUMA_PLAYERS) ? root.INAZUMA_PLAYERS : [];
  const officialTeams = () => Array.isArray(root.INAZUMA_TEAMS) ? root.INAZUMA_TEAMS : [];
  const officialIds = () => new Set(officialPlayers().flatMap((player) => [player?.id, player?.playerId]).map(String).filter(Boolean));
  const teamLookupValues = (team) => unique([team?.id, team?.name, ...(Array.isArray(team?.aliases) ? team.aliases : [])]).map(key);

  function load(storage = root.localStorage) {
    try {
      const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
    } catch { return []; }
  }

  function save(players, storage = root.localStorage) {
    storage?.setItem(STORAGE_KEY, JSON.stringify((Array.isArray(players) ? players : []).map(normalize).filter(Boolean)));
  }

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
      const ratings = JSON.parse(storage?.getItem("inazumaPlayerRatings") || "{}");
      delete ratings[String(playerIdValue)];
      storage?.setItem("inazumaPlayerRatings", JSON.stringify(ratings));
    } catch { /* ignore corrupted ratings */ }
    const db = root.INAZUMA_FIRESTORE;
    const auth = root.INAZUMA_FIREBASE_AUTH;
    if (db && auth?.currentUser) db.collection("inazumaRatingProjects").doc("main").collection("ratings").doc(String(playerIdValue)).delete().catch(() => {});
  }

  return { STORAGE_KEY, VALID_POSITIONS, VALID_ELEMENTS, load, save, nextId, normalize, allPlayers, isPlayerInTeam, customPlayersForTeam, removeRating };
});
