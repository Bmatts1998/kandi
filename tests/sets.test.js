"use strict";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const sets = require("../src/sets");

describe("set-time helpers", () => {
  test("parses lineup text with start and end times", () => {
    const ev = { startsAt: "2027-03-20T22:00:00-06:00" };
    const list = sets.parseLineupText("Yheti 11:30 PM – 1:00 AM\nToadface 10:00 PM", ev);
    assert.ok(list.length >= 2, JSON.stringify(list));
    assert.equal(list[0].artist, "Yheti");
    assert.match(list[0].startsAt, /T23:30:00-0[67]:00/);
    assert.equal(list[1].artist, "Toadface");
    assert.match(list[1].startsAt, /T22:00:00-0[67]:00/);
  });

  test("simple club lineup uses artist names without inventing stages", () => {
    const lineup = sets.lineupFromArtists({ artists: ["Yheti", "Toadface"], startsAt: "2027-03-20T22:00:00-06:00" });
    assert.equal(lineup.length, 2);
    assert.equal(lineup[0].artist, "Yheti");
    assert.equal(lineup[0].stage, "");
    assert.equal(lineup[0].startsAt, "");
  });

  test("a single-artist show can inherit the show start time", () => {
    const lineup = sets.lineupFromArtists({ artists: ["Yheti"], startsAt: "2027-03-20T22:00:00-06:00" });
    assert.equal(lineup.length, 1);
    assert.equal(lineup[0].startsAt, "2027-03-20T22:00:00-06:00");
  });

  test("badge names the artist and time", () => {
    const badge = sets.sharedSetBadge({ artist: "Yheti", startsAt: "2027-03-21T00:30:00-06:00" });
    assert.match(badge, /You both are catching Yheti at /);
    assert.match(badge, /12:30|11:30|12:30 AM|11:30 PM|12:30 am/i);
    const bare = sets.sharedSetBadge({ artist: "Yheti" });
    assert.equal(bare, "You both are catching Yheti");
  });

  test("demo show seed stays off hosted production unless explicitly enabled", () => {
    const saved = {
      RENDER: process.env.RENDER,
      RENDER_SERVICE_ID: process.env.RENDER_SERVICE_ID,
      SEED_DEMO_SHOWS: process.env.SEED_DEMO_SHOWS,
    };
    const restore = (key, val) => {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    };
    try {
      delete process.env.SEED_DEMO_SHOWS;
      delete process.env.RENDER;
      delete process.env.RENDER_SERVICE_ID;
      assert.equal(sets.allowDemoShowSeed(), true);
      process.env.RENDER = "true";
      assert.equal(sets.allowDemoShowSeed(), false);
      process.env.RENDER_SERVICE_ID = "srv-test";
      assert.equal(sets.allowDemoShowSeed(), false);
      process.env.SEED_DEMO_SHOWS = "1";
      assert.equal(sets.allowDemoShowSeed(), true);
      process.env.SEED_DEMO_SHOWS = "0";
      delete process.env.RENDER;
      delete process.env.RENDER_SERVICE_ID;
      assert.equal(sets.allowDemoShowSeed(), false);
    } finally {
      restore("RENDER", saved.RENDER);
      restore("RENDER_SERVICE_ID", saved.RENDER_SERVICE_ID);
      restore("SEED_DEMO_SHOWS", saved.SEED_DEMO_SHOWS);
    }
  });
});

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-sets-"));
  const dbPath = path.join(dir, "k.sqlite");
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: dbPath, SEED_ON_BOOT: "0", NODE_ENV: "production" };
  delete env.DATABASE_URL;
  for (const k of ["RENDER", "RENDER_SERVICE_ID", "RENDER_GIT_COMMIT", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "GMAIL_REFRESH_TOKEN", "EMAIL_PROVIDER", "EMAIL_VERIFICATION", "KANDI_PUBLIC_URL"]) {
    delete env[k];
  }
  const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const base = "http://127.0.0.1:" + port;
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start:\n" + out)), 60000);
    const iv = setInterval(() => {
      if (/listening on/.test(out)) { clearInterval(iv); clearTimeout(t); resolve(); }
    }, 100);
  });
  return { child, base, dbPath, ready, log: () => out, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function client(base) {
  const jar = new Map();
  function cookieHeader() {
    return Array.from(jar.entries()).map(([k, v]) => k + "=" + v).join("; ");
  }
  return async function call(method, url, body, headers) {
    const h = { "Content-Type": "application/json", ...(headers || {}) };
    const existing = cookieHeader();
    if (existing) h.Cookie = existing;
    const res = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    for (const line of raw) {
      const pair = String(line || "").split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

function signupBody(username, extra) {
  return Object.assign({ username, password: "test-pass-123", name: username[0].toUpperCase() + username.slice(1), age: 25, acceptedTerms: true, email: username + "@example.com", meetIntent: "both" }, extra || {});
}

function insertShow(dbPath, id) {
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.prepare(`
    INSERT INTO events (id, event_key, name, city, date_label, venue, genres, artists, emoji, color, is_example, category, starts_at, ends_at, status, time_tba)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,'rave',?,?,'active',0)
  `).run(
    id, "yheti-complex-2027-03-20", "Yheti", "Salt Lake City", "Sat, Mar 20, 2027 · 10:00 PM", "The Complex",
    "[]", '["Yheti"]', "🎧", "", "2027-03-20T22:00:00-06:00", "2027-03-21T02:00:00-06:00"
  );
  raw.close();
}

describe("set-time matching API", () => {
  let srv;
  before(async () => {
    srv = startServer();
    await srv.ready;
    insertShow(srv.dbPath, "sets-test-yheti");
  });
  after(() => srv && srv.stop());

  test("admin can add a set, going users can star it, suggestions need approval", async () => {
    const boston = client(srv.base);
    const alice = client(srv.base);
    const bob = client(srv.base);
    let r = await boston("POST", "/api/signup", signupBody("boston"));
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.user.isAdmin, true);
    r = await alice("POST", "/api/signup", signupBody("setalice"));
    assert.equal(r.status, 200, r.data.error);
    r = await bob("POST", "/api/signup", signupBody("setbob"));
    assert.equal(r.status, 200, r.data.error);

    r = await alice("POST", "/api/events/sets-test-yheti/sets", { artist: "Yheti", startsAt: "12:30 AM" });
    assert.equal(r.status, 403);

    r = await alice("POST", "/api/events/sets-test-yheti/going", { going: true });
    assert.equal(r.status, 200, r.data.error);
    r = await bob("POST", "/api/events/sets-test-yheti/going", { going: true });
    assert.equal(r.status, 200, r.data.error);

    r = await alice("POST", "/api/events/sets-test-yheti/sets", { artist: "Toadface", startsAt: "11:00 PM", endsAt: "12:30 AM" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.pending, true);
    assert.equal(r.data.set.status, "pending");
    const suggestedId = r.data.set.id;

    r = await alice("GET", "/api/events/sets-test-yheti/sets");
    assert.equal(r.status, 200);
    assert.equal((r.data.sets || []).length, 0, "pending suggestions stay off the public lineup");

    r = await boston("POST", "/api/admin/events/sets-test-yheti/sets", { artist: "Yheti", startsAt: "12:30 AM", endsAt: "2:00 AM" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.set.status, "approved");
    const yhetiId = r.data.set.id;
    assert.equal(r.data.set.startLabel, "12:30 AM");

    r = await boston("POST", "/api/admin/sets/" + suggestedId + "/review", { decision: "approve" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.set.status, "approved");

    r = await alice("POST", "/api/sets/" + yhetiId + "/catch", { catching: true });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.catching, true);
    assert.equal(r.data.set.imCatching, true);

    r = await bob("POST", "/api/sets/" + yhetiId + "/catch", { catching: true });
    assert.equal(r.status, 200, r.data.error);

    r = await alice("GET", "/api/events/sets-test-yheti/sets");
    assert.equal(r.status, 200);
    const yheti = r.data.sets.find((s) => s.artist === "Yheti");
    const toad = r.data.sets.find((s) => s.artist === "Toadface");
    assert.ok(yheti);
    assert.ok(toad);
    assert.ok(yheti.catchingCount >= 2);
    assert.ok((yheti.catchers || []).some((p) => p.name === "Setbob" || p.username === "setbob"));
  });

  test("blocks and hide-sets keep people off the lineup and out of Discover", async () => {
    const alice = client(srv.base);
    const hidden = client(srv.base);
    const blocked = client(srv.base);
    let r = await alice("POST", "/api/login", { username: "setalice", password: "test-pass-123" });
    if (r.status !== 200) r = await alice("POST", "/api/signup", signupBody("setalice"));
    r = await hidden("POST", "/api/signup", signupBody("sethidden"));
    assert.equal(r.status, 200, r.data.error);
    r = await blocked("POST", "/api/signup", signupBody("setblocked"));
    assert.equal(r.status, 200, r.data.error);

    await hidden("POST", "/api/events/sets-test-yheti/going", { going: true });
    await blocked("POST", "/api/events/sets-test-yheti/going", { going: true });

    const lineup = await alice("GET", "/api/events/sets-test-yheti/sets");
    const yheti = lineup.data.sets.find((s) => s.artist === "Yheti");
    assert.ok(yheti, "expected the Yheti set from the previous test");

    await hidden("POST", "/api/sets/" + yheti.id + "/catch", { catching: true });
    await blocked("POST", "/api/sets/" + yheti.id + "/catch", { catching: true });

    r = await hidden("PUT", "/api/me/sets-privacy", { hideSets: true });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.hideSets, true);

    r = await alice("POST", "/api/block", { userId: (await blocked("GET", "/api/me")).data.user.id, reason: "test" });
    assert.equal(r.status, 200, r.data.error);

    r = await alice("GET", "/api/events/sets-test-yheti/sets");
    const after = r.data.sets.find((s) => s.artist === "Yheti");
    const names = (after.catchers || []).map((p) => p.username);
    assert.ok(!names.includes("sethidden"), "hidden sets stay private");
    assert.ok(!names.includes("setblocked"), "blocked people stay off the lineup");

    r = await alice("GET", "/api/discover?sets=same");
    assert.equal(r.status, 200, r.data.error);
    const people = r.data.people || [];
    assert.ok(people.some((p) => p.username === "setbob"), "bob is catching the same set");
    assert.ok(!people.some((p) => p.username === "sethidden"));
    assert.ok(!people.some((p) => p.username === "setblocked"));
    const bob = people.find((p) => p.username === "setbob");
    assert.match(bob.sharedSetChip || "", /You both are catching Yheti at /);

    // Filter is free: iOS client, no Plus
    r = await alice("GET", "/api/discover?sets=same", undefined, { "x-kandi-client": "ios" });
    assert.equal(r.status, 200);
    assert.ok((r.data.people || []).some((p) => p.username === "setbob"));
  });

  test("un-RSVP drops starred sets, and unauthenticated users cannot write", async () => {
    const bob = client(srv.base);
    let r = await bob("POST", "/api/login", { username: "setbob", password: "test-pass-123" });
    assert.equal(r.status, 200, r.data.error);
    const before = await bob("GET", "/api/events/sets-test-yheti/sets");
    const yheti = before.data.sets.find((s) => s.artist === "Yheti");
    assert.equal(yheti.imCatching, true);

    r = await bob("POST", "/api/events/sets-test-yheti/going", { going: false });
    assert.equal(r.status, 200, r.data.error);

    r = await bob("POST", "/api/sets/" + yheti.id + "/catch", { catching: true });
    assert.equal(r.status, 403);

    r = await bob("POST", "/api/events/sets-test-yheti/going", { going: true });
    assert.equal(r.status, 200, r.data.error);
    const after = await bob("GET", "/api/events/sets-test-yheti/sets");
    const again = after.data.sets.find((s) => s.artist === "Yheti");
    assert.equal(again.imCatching, false, "starring is cleared when you leave the show");

    const anon = client(srv.base);
    r = await anon("GET", "/api/events/sets-test-yheti/sets");
    assert.equal(r.status, 401);
  });
});
