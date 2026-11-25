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
