"use strict";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const songs = require("../src/song");

const SAMPLE = {
  trackId: 897564278, trackName: "Say My Name (feat. Zyra)", artistName: "ODESZA", collectionName: "In Return",
  artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/76/5d/55/x/5021392959191.png/100x100bb.jpg",
  previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/a/b.m4a",
  trackViewUrl: "https://music.apple.com/us/album/say-my-name-feat-zyra/897564246?i=897564278&uo=4",
};

describe("song helpers", () => {
  test("normalizes an iTunes result and upsizes artwork", () => {
    const s = songs.normalizeSong(SAMPLE);
    assert.equal(s.title, "Say My Name (feat. Zyra)");
    assert.match(s.artworkUrl, /600x600bb\.jpg$/);
    assert.equal(s.previewUrl, SAMPLE.previewUrl);
    assert.deepEqual(songs.normalizeSong(s), s, "stored shape round-trips");
  });
  test("rejects junk and strips foreign URLs", () => {
    assert.equal(songs.normalizeSong({ trackId: "x", title: "a", artist: "b" }), null);
    assert.equal(songs.normalizeSong({ trackId: 1, title: "", artist: "b" }), null);
    const s = songs.normalizeSong({ trackId: 1, title: "t", artist: "a", artworkUrl: "https://evil.example/a.jpg", previewUrl: "javascript:alert(1)", trackViewUrl: "https://evil.example" });
    assert.equal(s.artworkUrl, ""); assert.equal(s.previewUrl, ""); assert.equal(s.trackViewUrl, "");
  });
  test("search caches results and filters to songs", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, status: 200, json: async () => ({ results: [SAMPLE, { ...SAMPLE }, { kind: "music-video", trackId: 5, trackName: "v", artistName: "a" }] }) }; };
    const a = await songs.searchSongs("Unit Test Query", { userId: 9, fetchImpl });
    const b = await songs.searchSongs("unit test query", { userId: 9, fetchImpl });
    assert.equal(a.results.length, 1);
    assert.equal(calls, 1);
    assert.equal(b.cached, true);
  });
});

describe("profile favorite song API", () => {
  let child, base, dir;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-song-"));
    const port = 20000 + Math.floor(Math.random() * 20000);
    base = "http://127.0.0.1:" + port;
    const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: path.join(dir, "k.sqlite"), NODE_ENV: "production" };
    delete env.DATABASE_URL;
    child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(out)), 60000);
      const iv = setInterval(() => { if (/listening on/.test(out)) { clearInterval(iv); clearTimeout(t); resolve(); } }, 100);
    });
  });
  after(() => { child && child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

  test("demo profiles have songs; save, keep, and clear work", async () => {
    let cookie = "";
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };
    let r = await call("POST", "/api/login", { username: "nova", password: "plur-demo" });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.favoriteSong && r.data.user.favoriteSong.artist, "Charlotte de Witte");
    r = await call("POST", "/api/signup", { username: "song_tester", password: "pass-12345", name: "Song", age: 25, acceptedTerms: true, email: "song@example.com" });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.favoriteSong, null);
    r = await call("PUT", "/api/me", { favoriteSong: songs.normalizeSong(SAMPLE) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.user.favoriteSong.trackId, SAMPLE.trackId);
    r = await call("PUT", "/api/me", { bio: "hi" });
    assert.equal(r.data.user.favoriteSong.trackId, SAMPLE.trackId, "omitted = unchanged");
    r = await call("PUT", "/api/me", { favoriteSong: { trackId: "nope" } });
    assert.equal(r.status, 400);
    r = await call("PUT", "/api/me", { favoriteSong: null });
    assert.equal(r.data.user.favoriteSong, null);
    r = await call("GET", "/api/music/search?q=a");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.results, []);
  });
});

describe("My songs (up to 5)", () => {
  const mk = (n) => songs.normalizeSong({ ...SAMPLE, trackId: SAMPLE.trackId + n, trackName: "Song " + n });
  test("helpers: list cap, dedupe, and single-song fallback", () => {
    assert.equal(songs.normalizeSongList([mk(1), mk(2), mk(2), mk(3), mk(4), mk(5), mk(6)]).length, 5);
    assert.deepEqual(songs.parseStoredSongs("", JSON.stringify(mk(1))).map((x) => x.trackId), [mk(1).trackId]);
    assert.deepEqual(songs.parseStoredSongs(JSON.stringify([mk(2), mk(1)]), JSON.stringify(mk(1))).map((x) => x.trackId), [mk(2).trackId, mk(1).trackId]);
    assert.deepEqual(songs.parseStoredSongs("[]", JSON.stringify(mk(1))), []);
  });

  let dir, port, child;
  const start = async () => {
    const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: path.join(dir, "k.sqlite"), NODE_ENV: "production" };
    delete env.DATABASE_URL;
    child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(out)), 60000);
      const iv = setInterval(() => { if (/listening on/.test(out)) { clearInterval(iv); clearTimeout(t); resolve(); } }, 100);
    });
  };
  const stop = () => new Promise((r) => { child.once("exit", r); child.kill(); });
  before(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-songs-")); port = 20000 + Math.floor(Math.random() * 20000); await start(); });
  after(async () => { if (child && child.exitCode == null) await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  test("save, reorder, cap, legacy single-song edits, demo lists, and migration", async () => {
    const base = "http://127.0.0.1:" + port;
    let cookie = "";
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };
    let r = await call("POST", "/api/login", { username: "luna", password: "plur-demo" });
    assert.ok(r.data.user.songs.length >= 3 && r.data.user.songs.length <= 5, "demo has 3-5 songs");
    assert.equal(r.data.user.favoriteSong.trackId, r.data.user.songs[0].trackId);
    cookie = "";
    r = await call("POST", "/api/signup", { username: "songs_tester", password: "pass-12345", name: "Songs", age: 25, acceptedTerms: true, email: "songs@example.com" });
    const myId = r.data.user.id;
    assert.deepEqual(r.data.user.songs, []);
    r = await call("PUT", "/api/me", { songs: [mk(1), mk(2), mk(3)] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.user.songs.map((x) => x.title), ["Song 1", "Song 2", "Song 3"]);
    assert.equal(r.data.user.favoriteSong.title, "Song 1");
    r = await call("PUT", "/api/me", { songs: [mk(3), mk(1), mk(2)] });
    assert.deepEqual(r.data.user.songs.map((x) => x.title), ["Song 3", "Song 1", "Song 2"], "reorder sticks");
    assert.equal(r.data.user.favoriteSong.title, "Song 3", "first slot is the favorite");
    assert.equal((await call("PUT", "/api/me", { songs: [mk(1), mk(2), mk(3), mk(4), mk(5), mk(6)] })).status, 400, "max 5");
    assert.equal((await call("PUT", "/api/me", { songs: [mk(1), { trackId: "x" }] })).status, 400, "junk rejected");
    r = await call("PUT", "/api/me", { songs: [mk(1), mk(2), mk(3), mk(4), mk(5)] });
    assert.equal(r.data.user.songs.length, 5);
    r = await call("PUT", "/api/me", { bio: "x" });
    assert.equal(r.data.user.songs.length, 5, "omitted = unchanged");
    // Older app builds only send favoriteSong: it replaces slot 1 and keeps the rest.
    r = await call("PUT", "/api/me", { favoriteSong: mk(9) });
    assert.deepEqual(r.data.user.songs.map((x) => x.title), ["Song 9", "Song 2", "Song 3", "Song 4", "Song 5"]);
    r = await call("GET", "/api/users/" + myId);
    assert.equal(r.data.user.songs.length, 5, "others see the list");
    r = await call("PUT", "/api/me", { songs: [] });
    assert.deepEqual(r.data.user.songs, []);
    assert.equal(r.data.user.favoriteSong, null);

    // Migration: an account with only the old single favorite_song gets it in slot 1.
    await stop();
    const { DatabaseSync } = require("node:sqlite");
    const raw = new DatabaseSync(path.join(dir, "k.sqlite"));
    raw.prepare("UPDATE users SET favorite_song=?, songs='' WHERE id=?").run(JSON.stringify(mk(7)), myId);
    raw.close();
    await start();
    cookie = "";
    await call("POST", "/api/login", { username: "songs_tester", password: "pass-12345" });
    r = await call("GET", "/api/me");
    assert.deepEqual(r.data.user.songs.map((x) => x.title), ["Song 7"]);
  });
});
