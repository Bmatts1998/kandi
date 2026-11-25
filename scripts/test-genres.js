"use strict";

const assert = require("assert");
const {
  MAX_GENRES,
  catalog,
  canonId,
  normalizeGenreIds,
  publicGenres,
  sharedGenreIds,
  sharedGenreChip,
  eventMatchesGenre,
} = require("../src/genres");
const { compareDiscover } = require("../src/engagement");

function check(name, fn) {
  try { fn(); console.log("ok  " + name); }
  catch (err) { console.error("FAIL " + name + "\n  " + (err && err.stack || err)); process.exitCode = 1; }
}

check("catalog includes requested genres", () => {
  const ids = catalog().map((g) => g.id);
  for (const id of ["dubstep", "riddim", "bass-music", "house", "tech-house", "deep-house", "techno", "trance", "dnb", "hardstyle", "trap", "future-bass", "melodic-bass", "big-room", "progressive-house", "psytrance", "jungle", "ukg", "hardcore", "lofi", "disco-funk", "experimental", "edm"]) {
    assert.ok(ids.includes(id), "missing " + id);
  }
  assert.ok(catalog().every((g) => g.name && g.short && g.color && g.icon));
});

check("legacy music field values migrate", () => {
  assert.strictEqual(canonId("bass"), "bass-music");
  assert.strictEqual(canonId("drum & bass"), "dnb");
  assert.strictEqual(canonId("garage"), "ukg");
  assert.strictEqual(canonId("disco"), "disco-funk");
  assert.strictEqual(canonId("rhythm"), "riddim");
  const ids = normalizeGenreIds(["techno", "bass", "house", "drum & bass", "not-a-genre", "techno"]);
  assert.deepStrictEqual(ids, ["techno", "bass-music", "house", "dnb"]);
});

check("caps at 5 and public genres have colors", () => {
  const ids = normalizeGenreIds(["house", "techno", "dubstep", "trance", "dnb", "trap", "edm"]);
  assert.strictEqual(ids.length, MAX_GENRES);
  const pub = publicGenres(["house", "bass"]);
  assert.strictEqual(pub[0].name, "House");
  assert.strictEqual(pub[1].id, "bass-music");
  assert.ok(pub[1].color);
});

check("shared genres and event matching", () => {
  assert.deepStrictEqual(sharedGenreIds(["house", "techno"], ["techno", "dubstep"]), ["techno"]);
  assert.ok(sharedGenreChip(["house", "techno"], ["techno"]).includes("Techno"));
  assert.ok(eventMatchesGenre({ genres: ["House", "Techno"] }, "house"));
  assert.ok(eventMatchesGenre({ genres: ["bass", "dubstep"] }, "bass-music"));
  assert.ok(!eventMatchesGenre({ genres: ["rock"] }, "techno"));
});

check("shared genre count is a light discover boost after shared shows", () => {
  const shows = new Map([[1, 0], [2, 0], [3, 2]]);
  const genres = new Map([[1, 3], [2, 0], [3, 0]]);
  const a = { id: 1, engagement_score: 1, last_active_at: "2020" };
  const b = { id: 2, engagement_score: 10, last_active_at: "2026" };
  const c = { id: 3, engagement_score: 0, last_active_at: "2019" };
  const list = [a, b, c].sort((x, y) => compareDiscover(x, y, shows, genres));
  assert.strictEqual(list[0].id, 3); // same show still wins
  assert.strictEqual(list[1].id, 1); // more shared genres beat higher engagement
  assert.strictEqual(list[2].id, 2);
});

if (!process.exitCode) console.log("All genre tests passed.");
