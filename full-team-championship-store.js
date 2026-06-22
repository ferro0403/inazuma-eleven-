(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InazumaFullTeamChampionshipStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const STORAGE_KEY = "inazuma-full-team-championships-v1";
  const clean = (value) => String(value ?? "").trim();
  const uniqueNumbers = (values) => [...new Set((Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite))];
  const slug = (name) => clean(name).toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "championship";

  function normalizeChampionship(championship = {}, fallbackNumber = 1) {
    const now = new Date().toISOString();
    const name = clean(championship.name) || `Championship ${fallbackNumber}`;
    return {
      id: clean(championship.id) || `${slug(name)}_${fallbackNumber}`,
      name,
      teams: (Array.isArray(championship.teams) ? championship.teams : []).map((entry) => ({
        teamId: clean(entry?.teamId),
        playerIds: uniqueNumbers(entry?.playerIds),
        manualPlayerIds: uniqueNumbers(entry?.manualPlayerIds),
      })).filter((entry) => entry.teamId),
      createdAt: clean(championship.createdAt) || now,
      updatedAt: clean(championship.updatedAt) || now,
    };
  }

  function load(storage) {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value.map(normalizeChampionship) : [];
    } catch { return []; }
  }

  function save(storage, championships) {
    storage.setItem(STORAGE_KEY, JSON.stringify(championships.map(normalizeChampionship)));
  }

  function nextId(name, championships) {
    const base = slug(name);
    let id = base;
    let number = 2;
    const ids = new Set(championships.map((item) => item.id));
    while (ids.has(id)) id = `${base}_${number++}`;
    return id;
  }

  function create(name, championships = []) {
    const now = new Date().toISOString();
    const championshipName = clean(name) || `Championship ${championships.length + 1}`;
    return { id: nextId(championshipName, championships), name: championshipName, teams: [], createdAt: now, updatedAt: now };
  }

  function duplicate(championship, championships = []) {
    const now = new Date().toISOString();
    return normalizeChampionship({ ...championship, id: nextId(`${championship.name} Copy`, championships), name: `${championship.name} Copy`, createdAt: now, updatedAt: now }, championships.length + 1);
  }

  function fullTeamEntry(team) {
    return { teamId: team.id, playerIds: uniqueNumbers(team.playerIds), manualPlayerIds: [] };
  }

  function resetToFullRoster(entry, team) {
    entry.playerIds = uniqueNumbers(team?.playerIds);
    entry.manualPlayerIds = [];
    return entry;
  }

  function validate(championship, teams, players) {
    const errors = [];
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const playersById = new Map(players.map((player) => [Number(player.id), player]));
    const selected = new Set();
    normalizeChampionship(championship).teams.forEach((entry) => {
      const label = entry.teamId || "selected team";
      const team = teamsById.get(entry.teamId);
      if (selected.has(entry.teamId)) errors.push(`${label}: duplicate team selected.`);
      selected.add(entry.teamId);
      if (!team) { errors.push(`${label}: team does not exist in teams.js.`); return; }
      if (!entry.playerIds.length) errors.push(`${team.name}: roster must contain at least 1 player.`);
      const teamIds = new Set(uniqueNumbers(team.playerIds));
      const manualIds = new Set(entry.manualPlayerIds);
      entry.playerIds.forEach((playerId) => {
        if (!playersById.has(playerId)) errors.push(`${team.name}: player ${playerId} does not exist in players.js.`);
        else if (!teamIds.has(playerId) && !manualIds.has(playerId)) errors.push(`${team.name}: player ${playerId} is not on this team roster.`);
      });
    });
    if (!normalizeChampionship(championship).teams.length) errors.push("Select at least one participating team.");
    return { valid: errors.length === 0, errors };
  }

  function publicChampionship(championship) {
    const normalized = normalizeChampionship(championship);
    return {
      id: normalized.id,
      name: normalized.name,
      teams: normalized.teams.map((entry) => ({ teamId: entry.teamId, playerIds: entry.playerIds })),
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
    };
  }

  function exportText(championships, teams, players) {
    const invalid = championships.map((championship) => ({ championship, result: validate(championship, teams, players) })).filter((item) => !item.result.valid);
    if (invalid.length) throw new Error(invalid.map((item) => `${item.championship.name}: ${item.result.errors.join(" ")}`).join("\n"));
    return `const fullTeamChampionships = ${JSON.stringify(championships.map(publicChampionship), null, 2)};\n`;
  }

  return { STORAGE_KEY, normalizeChampionship, load, save, nextId, create, duplicate, fullTeamEntry, resetToFullRoster, validate, publicChampionship, exportText };
});
