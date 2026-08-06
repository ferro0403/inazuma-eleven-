(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InazumaTournamentStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const STORAGE_KEY = "inazuma-mini-tournaments-v1";
  const clean = (value) => String(value ?? "").trim();
  const uniqueNumbers = (values) => [...new Set((Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite))];
  const slug = (name) => clean(name).toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "mini_tournament";

  function normalizeTournament(tournament = {}, fallbackNumber = 1) {
    const now = new Date().toISOString();
    const name = clean(tournament.name) || `Mini Tournament ${fallbackNumber}`;
    return {
      id: clean(tournament.id) || `${slug(name)}_${fallbackNumber}`,
      name,
      teams: (Array.isArray(tournament.teams) ? tournament.teams : []).map((entry) => ({
        teamId: clean(entry?.teamId),
        playerIds: uniqueNumbers(entry?.playerIds),
      })).filter((entry) => entry.teamId),
      createdAt: clean(tournament.createdAt) || now,
      updatedAt: clean(tournament.updatedAt) || now,
    };
  }

  function load(storage) {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value.map(normalizeTournament) : [];
    } catch { return []; }
  }

  function save(storage, tournaments) {
    storage.setItem(STORAGE_KEY, JSON.stringify(tournaments.map(normalizeTournament)));
  }

  function nextId(name, tournaments) {
    const base = slug(name);
    let id = base;
    let number = 2;
    const ids = new Set(tournaments.map((item) => item.id));
    while (ids.has(id)) id = `${base}_${number++}`;
    return id;
  }

  function create(name, tournaments = []) {
    const now = new Date().toISOString();
    const tournamentName = clean(name) || `Mini Tournament ${tournaments.length + 1}`;
    return { id: nextId(tournamentName, tournaments), name: tournamentName, teams: [], createdAt: now, updatedAt: now };
  }

  function duplicate(tournament, tournaments = []) {
    const now = new Date().toISOString();
    return normalizeTournament({ ...tournament, id: nextId(`${tournament.name} Copy`, tournaments), name: `${tournament.name} Copy`, createdAt: now, updatedAt: now }, tournaments.length + 1);
  }

  function validate(tournament, teams, players) {
    const errors = [];
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const playersById = new Map(players.map((player) => [Number(player.id), player]));
    const selected = new Set();
    normalizeTournament(tournament).teams.forEach((entry, index) => {
      const label = entry.teamId || `team ${index + 1}`;
      const team = teamsById.get(entry.teamId);
      if (selected.has(entry.teamId)) errors.push(`${label}: duplicate team selected.`);
      selected.add(entry.teamId);
      if (!team) { errors.push(`${label}: team does not exist in teams.js.`); return; }
      if (entry.playerIds.length !== 6) errors.push(`${team.name}: choose exactly 6 players.`);
      entry.playerIds.forEach((playerId) => {
        if (!playersById.has(playerId)) errors.push(`${team.name}: player ${playerId} does not exist in players.js.`);
        else if (!team.playerIds.map(Number).includes(playerId)) errors.push(`${team.name}: player ${playerId} does not belong to this team.`);
      });
    });
    if (!normalizeTournament(tournament).teams.length) errors.push("Select at least one participating team.");
    return { valid: errors.length === 0, errors };
  }

  function publicTournament(tournament) {
    const normalized = normalizeTournament(tournament);
    return {
      id: normalized.id,
      name: normalized.name,
      teams: normalized.teams.map((entry) => ({ teamId: entry.teamId, playerIds: entry.playerIds })),
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
    };
  }

  function exportText(tournaments, teams, players) {
    const invalid = tournaments.map((tournament) => ({ tournament, result: validate(tournament, teams, players) })).filter((item) => !item.result.valid);
    if (invalid.length) throw new Error(invalid.map((item) => `${item.tournament.name}: ${item.result.errors.join(" ")}`).join("\n"));
    return `const miniTournaments = ${JSON.stringify(tournaments.map(publicTournament), null, 2)};\n`;
  }

  return { STORAGE_KEY, normalizeTournament, load, save, nextId, create, duplicate, validate, publicTournament, exportText };
});
