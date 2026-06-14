"use strict";
const assert = require("node:assert/strict");
const Store = require("../team-store.js");

const players = [
  { id: 1, name: "Mark", teams: ["Raimon", "Raimon GO"] },
  { id: 2, name: "Nathan", teams: ["Raimon Junior High"] },
  { id: 3, name: "Jack", teams: ["Royal Academy"] },
];
const seeds = [{ id: "raimon", name: "Raimon", logoUrl: "logo.png", aliases: ["Raimon GO", "Raimon Junior High"], playerIds: [], notes: "seed" }];
let teams = Store.hydrate(players, seeds, []);
let raimon = teams.find((team) => team.id === "raimon");
assert.deepEqual(raimon.playerIds, [1, 2]);
assert.equal(raimon.logoUrl, "logo.png");
assert.equal(teams.find((team) => team.name === "Royal Academy").playerIds[0], 3);

Store.removePlayer(raimon, 1);
teams = Store.hydrate(players, seeds, teams);
raimon = teams.find((team) => team.id === "raimon");
assert.deepEqual(raimon.playerIds, [2]);
Store.addPlayer(raimon, 1);
assert.deepEqual(raimon.playerIds, [2, 1]);

const royal = teams.find((team) => team.name === "Royal Academy");
teams = Store.mergeInto(teams, [raimon.id, royal.id], raimon.id);
assert.equal(teams.length, 1);
assert.ok(raimon.aliases.includes("Royal Academy"));
assert.deepEqual(new Set(raimon.playerIds), new Set([1, 2, 3]));

const publicRecord = Store.publicTeam(raimon);
assert.deepEqual(Object.keys(publicRecord), ["id", "name", "logoUrl", "aliases", "playerIds", "notes"]);

const consolidated = Store.hydrate(players, seeds, [
  { id: "raimon-go", name: "Raimon GO", aliases: [], playerIds: [99], notes: "" },
]);
assert.equal(consolidated.some((team) => team.id === "raimon-go"), false);
assert.ok(consolidated.find((team) => team.id === "raimon").playerIds.includes(99));

const memory = {
  values: new Map(),
  getItem(key) { return this.values.get(key) ?? null; },
  setItem(key, value) { this.values.set(key, value); },
};
Store.backup(memory, consolidated, "Merge aliases");
const backups = JSON.parse(memory.getItem(Store.BACKUP_KEY));
assert.equal(backups.length, 1);
assert.equal(backups[0].action, "Merge aliases");
console.log("Team store tests passed.");
