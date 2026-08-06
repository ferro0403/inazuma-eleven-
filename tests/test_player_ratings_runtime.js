"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const values = new Map();
const localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
const players = [
  { id: 1, name: "Mark Evans", position: "GK" },
  { id: 2, name: "Axel Blaze", position: "FW" },
  { id: 5, name: "Jack Wallside", position: "DF" },
  { id: 9, name: "Jude Sharp", position: "MF" },
];
const context = {
  console,
  INAZUMA_RATINGS_TEST_MODE: true,
  INAZUMA_PLAYERS: players,
  INAZUMA_TEAMS: [{ id: "raimon-2", name: "Raimon Inazuma Eleven 2", playerIds: [1, 5, 2, 9] }],
  InazumaCustomPlayers: { load: () => [], customPlayersForTeam: () => [] },
  InazumaTeamStore: { load: () => [], hydrate: (_players, teams) => teams },
  localStorage,
  document: { querySelector: (selector) => selector === "#ratings-debug" ? { replaceChildren() {} } : null, createElement: () => ({ append() {} }) },
  location: { protocol: "http:" },
  requestAnimationFrame: (callback) => callback(),
  setTimeout,
  clearTimeout,
  confirm: () => true,
};
context.window = context;
context.globalThis = context;
vm.runInNewContext(fs.readFileSync("player-ratings.js", "utf8"), context, { filename: "player-ratings.js" });

const api = context.InazumaPlayerRatings.__testing;
const stats = { attack: 4, physical: 8, stamina: 7, control: 5, defense: 10, speed: 6, grit: 9, save: 1 };
const legacy = { ...stats, overall: 87, evaluated: true, updatedAt: "2026-01-02T00:00:00.000Z", updatedBy: "Legacy", customMetadata: "kept" };

for (const [id, role] of [[5, "DF"], [1, "GK"], [2, "FW"], [9, "MF"]]) {
  const normalized = api.normalizeRatingForPlayer(id, legacy);
  assert.equal(normalized.roleVariants.length, 1);
  assert.equal(normalized.position, role);
  assert.equal(normalized.roleVariants[0].variantId, role.toLowerCase());
  assert.equal(normalized.defaultRoleVariantId, role.toLowerCase());
  assert.equal(normalized.roleSwitchEnabled, false);
  assert.deepEqual(Object.fromEntries(Object.keys(stats).map((key) => [key, normalized[key]])), stats);
  assert.equal(normalized.overall, 87);
}

api.setRatings({});
assert.equal(api.mergeRatingRecord(5, legacy), true);
let jack = api.state().ratings[5];
assert.equal(jack.position, "DF");
assert.equal(jack.customMetadata, "kept");
assert.equal(jack.updatedBy, "Legacy");

const markMultiRole = {
  roleVariants: [
    { variantId: "gk", position: "GK", ...stats, overall: 88, evaluated: true, updatedAt: "2026-02-01T00:00:00Z" },
    { variantId: "mf", position: "MF", ...stats, overall: 79, evaluated: true, updatedAt: "2026-02-01T00:00:00Z" },
  ],
  defaultRoleVariantId: "gk",
  roleSwitchEnabled: true,
  updatedAt: "2026-02-01T00:00:00Z",
};
api.setRatings({});
api.mergeRatingRecord(1, markMultiRole);
const mergedMark = api.state().ratings[1];
assert.equal(mergedMark.roleVariants.length, 2);
assert.deepEqual(Array.from(mergedMark.roleVariants, (variant) => variant.variantId), ["gk", "mf"]);
assert.equal(mergedMark.roleSwitchEnabled, true);

const localNewer = { ...api.normalizeRatingForPlayer(5, { ...legacy, updatedAt: "2026-04-02T00:00:00Z" }), playerId: "5" };
api.setRatings({ 5: localNewer });
assert.equal(api.mergeRatingRecord(5, { ...legacy, updatedAt: "2026-04-01T00:00:00Z" }), false);
assert.equal(api.state().ratings[5].updatedAt, "2026-04-02T00:00:00Z");
assert.equal(api.mergeRatingRecord(5, { ...legacy, overall: 90, updatedAt: "2026-04-03T00:00:00Z" }), true);
assert.equal(api.state().ratings[5].overall, 90);
assert.equal(api.shouldUseIncoming({ updatedAt: "2026-04-04T00:00:00Z", clientUpdatedAt: "2026-04-06T00:00:00Z" }, { updatedAt: "2026-04-05T00:00:00Z" }), false);
api.setPendingSync({ 5: { operation: "set", queuedAt: "2026-04-07T00:00:00Z" } });
assert.equal(api.mergeRemoteRatingRecord(5, { ...legacy, overall: 99, updatedAt: "2026-04-08T00:00:00Z" }), false);
assert.equal(api.state().ratings[5].overall, 90);
api.setPendingSync({});

api.setRatings({ 1: mergedMark, 5: api.normalizeRatingForPlayer(5, legacy) });
api.selectVariant(players[0], "mf");
assert.equal(api.state().editorDraft.variantId, "mf");
api.resetEditorForPlayer(players[2]);
assert.equal(api.state().editorDraft.variantId, "df");
api.saveRating(players[2], api.state().editorDraft);
assert.equal(api.state().ratings[5].roleVariants.length, 1);
assert.equal(api.state().ratings[5].position, "DF");
assert.deepEqual(Array.from(api.state().ratings[1].roleVariants, (variant) => variant.variantId), ["gk", "mf"]);
// Previous, next, save-and-next and team changes all use the same reset primitive.
for (const destination of [players[0], players[2], players[1], null]) {
  api.resetEditorForPlayer(destination);
  assert.equal(api.state().activeRoleVariantId, destination ? destination.position.toLowerCase() : "");
}

const payload = api.firestorePayload(1, mergedMark);
assert.equal(payload.position, "GK");
assert.equal(payload.evaluated, true);
assert.equal(payload.overall, 88);
assert.equal(payload.defense, stats.defense);
assert.equal(payload.roleVariants.length, 2);
assert.equal(payload.defaultRoleVariantId, "gk");
assert.equal(payload.roleSwitchEnabled, true);

console.log("Player ratings runtime regression tests passed.");
