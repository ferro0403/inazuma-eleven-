"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const index = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const full = fs.readFileSync("full-team-championships.js", "utf8");
const miniStore = fs.readFileSync("tournament-store.js", "utf8");

assert.match(index, /id="tournament-team-cards"/);
assert.match(index, /id="championship-team-cards"/);
assert.match(app, /function renderTournamentTeamCards/);
assert.match(full, /function renderTeamCards/);
assert.match(app, /View players/);
assert.match(full, /View players/);
assert.match(full, /headCoachId/);
assert.match(full, /staffIds/);
assert.doesNotMatch(miniStore, /headCoachId|staffIds/);
assert.doesNotMatch(app, /headCoachId|staffIds/);
const ratings = fs.readFileSync("player-ratings.js", "utf8");
assert.match(index, /data-view="ratings"/);
assert.match(index, /id="ratings-view"/);
assert.match(index, /player-ratings\.js/);
assert.match(app, /InazumaPlayerRatings\?\.render/);
assert.match(ratings, /globalThis\.INAZUMA_PLAYERS/);
assert.match(ratings, /globalThis\.INAZUMA_TEAMS/);
assert.doesNotMatch(ratings, /fetch\s*\(/);
assert.doesNotMatch(ratings, /import\s|export\s|type="module"/);

console.log("UI contract tests passed.");
