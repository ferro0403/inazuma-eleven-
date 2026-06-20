"use strict";
const assert = require("node:assert/strict");
const Tournaments = require("../tournament-store.js");

const players = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `Player ${index + 1}` }));
const teams = [
  { id: "raimon", name: "Raimon", playerIds: [1, 2, 3, 4, 5, 6] },
  { id: "royal_academy", name: "Royal Academy", playerIds: [7, 8, 9, 10, 11, 12] },
];
const tournament = {
  id: "mini_tournament_1",
  name: "Mini Tournament 1",
  teams: [
    { teamId: "raimon", playerIds: [1, 2, 3, 4, 5, 6] },
    { teamId: "royal_academy", playerIds: [7, 8, 9, 10, 11, 12] },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
assert.equal(Tournaments.validate(tournament, teams, players).valid, true);
const exported = Tournaments.exportText([tournament], teams, players);
assert.match(exported, /^const miniTournaments = /);
assert.match(exported, /"teamId": "raimon"/);
assert.doesNotMatch(exported, /"logoUrl"|"position"|"element"/);

const invalid = Tournaments.normalizeTournament({ name: "Bad", teams: [{ teamId: "raimon", playerIds: [1, 2, 99] }, { teamId: "raimon", playerIds: [1, 2, 3, 4, 5, 7] }] });
const errors = Tournaments.validate(invalid, teams, players).errors.join(" ");
assert.match(errors, /duplicate team/);
assert.match(errors, /exactly 6/);
assert.match(errors, /does not exist/);
assert.match(errors, /does not belong/);
assert.throws(() => Tournaments.exportText([invalid], teams, players), /Bad:/);

const memory = { value: "", getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
Tournaments.save(memory, [tournament]);
assert.equal(Tournaments.load(memory)[0].teams[0].playerIds.length, 6);
console.log("Tournament store tests passed.");
