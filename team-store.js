(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InazumaTeamStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const STORAGE_KEY = "inazuma-team-manager-v1";
  const BACKUP_KEY = "inazuma-team-manager-backups-v1";
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const clean = (value) => String(value ?? "").trim();
  const unique = (values) => [...new Set(values)];
  const slug = (name) => clean(name).toLocaleLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";

  function normalizeTeam(team, fallbackName = "Team") {
    const name = clean(team?.name) || fallbackName;
    return {
      id: clean(team?.id) || slug(name),
      name,
      logoUrl: clean(team?.logoUrl),
      aliases: unique((Array.isArray(team?.aliases) ? team.aliases : []).map(clean).filter(Boolean)),
      playerIds: unique((Array.isArray(team?.playerIds) ? team.playerIds : []).map(Number).filter(Number.isFinite)),
      notes: clean(team?.notes),
      custom: Boolean(team?.custom),
      removedPlayerIds: unique((Array.isArray(team?.removedPlayerIds) ? team.removedPlayerIds : []).map(Number).filter(Number.isFinite)),
    };
  }

  function playerTeamNames(player) {
    const teams = Array.isArray(player?.teams) ? player.teams : player?.teams ? [player.teams] : [];
    return teams.map(clean).filter(Boolean);
  }

  function nextId(name, teams) {
    const base = slug(name);
    let id = base;
    let number = 2;
    const ids = new Set(teams.map((team) => team.id));
    while (ids.has(id)) id = `${base}-${number++}`;
    return id;
  }

  function hydrate(players, seeds = [], saved = []) {
    let teams = [];
    const byId = new Map();
    [...seeds, ...saved].forEach((raw, index) => {
      const team = normalizeTeam(raw, `Team ${index + 1}`);
      const previous = byId.get(team.id);
      if (previous) Object.assign(previous, team);
      else { teams.push(team); byId.set(team.id, team); }
    });

    // An explicit alias is authoritative over an automatically generated team
    // with that name. Consolidate it into the canonical team immediately.
    const aliasOwner = new Map();
    teams.forEach((team) => team.aliases.forEach((alias) => {
      aliasOwner.set(alias.toLocaleLowerCase(), team);
    }));
    teams.slice().forEach((team) => {
      const owner = aliasOwner.get(team.name.toLocaleLowerCase());
      if (!owner || owner === team) return;
      owner.playerIds = unique([...owner.playerIds, ...team.playerIds]);
      owner.removedPlayerIds = unique([...owner.removedPlayerIds, ...team.removedPlayerIds])
        .filter((id) => !owner.playerIds.includes(id));
      if (!owner.logoUrl && team.logoUrl) owner.logoUrl = team.logoUrl;
      if (team.notes) owner.notes = clean([owner.notes, team.notes].filter(Boolean).join("\n"));
      teams = teams.filter((candidate) => candidate !== team);
    });

    const canonical = new Map();
    teams.forEach((team) => canonical.set(team.name.toLocaleLowerCase(), team));
    teams.forEach((team) => team.aliases.forEach((alias) => canonical.set(alias.toLocaleLowerCase(), team)));

    players.forEach((player) => playerTeamNames(player).forEach((sourceName) => {
      let team = canonical.get(sourceName.toLocaleLowerCase());
      if (!team) {
        team = normalizeTeam({ id: nextId(sourceName, teams), name: sourceName });
        teams.push(team);
        canonical.set(sourceName.toLocaleLowerCase(), team);
      }
      const playerId = Number(player.id);
      if (!team.removedPlayerIds.includes(playerId) && !team.playerIds.includes(playerId)) team.playerIds.push(playerId);
    }));

    return teams.map(normalizeTeam).sort((a, b) => collator.compare(a.name, b.name));
  }

  function publicTeam(team) {
    const { id, name, logoUrl, aliases, playerIds, notes } = normalizeTeam(team);
    return { id, name, logoUrl, aliases, playerIds, notes };
  }

  function save(storage, teams) {
    storage.setItem(STORAGE_KEY, JSON.stringify(teams.map(normalizeTeam)));
  }

  function load(storage) {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value.map(normalizeTeam) : [];
    } catch { return []; }
  }

  function backup(storage, teams, action) {
    let backups = [];
    try { backups = JSON.parse(storage.getItem(BACKUP_KEY) || "[]"); } catch { backups = []; }
    backups.unshift({ createdAt: new Date().toISOString(), action, teams: teams.map(normalizeTeam) });
    storage.setItem(BACKUP_KEY, JSON.stringify(backups.slice(0, 20)));
    return backups[0];
  }

  function addPlayer(team, playerId) {
    const id = Number(playerId);
    team.playerIds = unique([...team.playerIds, id]);
    team.removedPlayerIds = team.removedPlayerIds.filter((value) => value !== id);
  }

  function removePlayer(team, playerId) {
    const id = Number(playerId);
    team.playerIds = team.playerIds.filter((value) => value !== id);
    team.removedPlayerIds = unique([...team.removedPlayerIds, id]);
  }

  function mergeInto(teams, sourceIds, targetId) {
    const target = teams.find((team) => team.id === targetId);
    if (!target) throw new Error("Merge target was not found.");
    const sources = teams.filter((team) => sourceIds.includes(team.id) && team.id !== targetId);
    sources.forEach((source) => {
      target.aliases = unique([...target.aliases, source.name, ...source.aliases].filter((name) => name !== target.name));
      target.playerIds = unique([...target.playerIds, ...source.playerIds]);
      target.removedPlayerIds = target.removedPlayerIds.filter((id) => !source.playerIds.includes(id));
      if (source.notes) target.notes = clean([target.notes, source.notes].filter(Boolean).join("\n"));
      if (!target.logoUrl && source.logoUrl) target.logoUrl = source.logoUrl;
    });
    return teams.filter((team) => !sources.includes(team));
  }

  return { STORAGE_KEY, BACKUP_KEY, normalizeTeam, playerTeamNames, hydrate, publicTeam, save, load, backup, nextId, addPlayer, removePlayer, mergeInto };
});
