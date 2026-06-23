"use strict";
const assert = require("node:assert/strict");
const Store = require("../full-team-championship-store.js");

const players = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: `Player ${index + 1}` }));
const teams = [
  { id: "raimon", name: "Raimon", playerIds: [1, 2, 3, 4] },
  { id: "royal_academy", name: "Royal Academy", playerIds: [5, 6, 7, 8] },
];
const championship = {
  id: "championship_1",
  name: "Championship 1",
  teams: [{ ...Store.fullTeamEntry(teams[0]), headCoachId: 1, staffIds: [2] }, Store.fullTeamEntry(teams[1])],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
assert.equal(Store.validate(championship, teams, players).valid, true);
const exported = Store.exportText([championship], teams, players);
assert.match(exported, /^const fullTeamChampionships = /);
assert.match(exported, /"teamId": "raimon"/);
assert.match(exported, /"headCoachId": 1/);
assert.match(exported, /"staffIds": \[\n          2\n        \]/);
assert.doesNotMatch(exported, /"logoUrl"|"position"|"element"|"manualPlayerIds"/);

const custom = Store.normalizeChampionship({ name: "Custom", teams: [{ teamId: "raimon", playerIds: [1, 99], manualPlayerIds: [99] }] });
assert.match(Store.validate(custom, teams, [...players, { id: 99, name: "Guest" }]).errors.join(" "), /^$/);
const invalid = Store.normalizeChampionship({ name: "Bad", teams: [{ teamId: "raimon", playerIds: [], headCoachId: 1, staffIds: [1] }, { teamId: "raimon", playerIds: [1, 9], headCoachId: 8, staffIds: [8, 8] }] });
const errors = Store.validate(invalid, teams, players).errors.join(" ");
assert.match(errors, /duplicate team/);
assert.match(errors, /at least 1 player/);
assert.match(errors, /does not exist/);
assert.match(errors, /same person cannot be both head coach and staff/);
assert.deepEqual(Store.normalizeChampionship({ teams: [{ teamId: "raimon", staffIds: [2, 2] }] }).teams[0].staffIds, [2]);
assert.match(errors, /head coach 8 is not on this team/);
assert.throws(() => Store.exportText([invalid], teams, players), /Bad:/);

const memory = { value: "", getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
Store.save(memory, [championship]);
assert.equal(Store.load(memory)[0].teams[0].playerIds.length, 4);
console.log("Full championship store tests passed.");
