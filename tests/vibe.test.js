"use strict";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const vibe = require("../src/vibe");

describe("show vibe helpers", () => {
  test("normalizes the three approved tags and blank", () => {
    assert.equal(vibe.normalizeVibe("going_sober"), "going_sober");
    assert.equal(vibe.normalizeVibe("Going sober"), "going_sober");
    assert.equal(vibe.normalizeVibe("sober-friendly"), "sober_friendly");
    assert.equal(vibe.normalizeVibe("Here to party"), "party");
    assert.equal(vibe.normalizeVibe(""), "");
    assert.equal(vibe.normalizeVibe("none"), "");
    assert.equal(vibe.normalizeVibe("all"), "");
    assert.equal(vibe.normalizeVibe(undefined), undefined);
    assert.equal(vibe.normalizeVibe(null, { omitted: "" }), "");
    assert.equal(vibe.normalizeVibe("something-else"), null);
  });

  test("labels use the exact approved wording and emojis", () => {
    assert.equal(vibe.vibeLabel("going_sober"), "Going sober 💧");
    assert.equal(vibe.vibeLabel("sober_friendly"), "Sober-friendly");
    assert.equal(vibe.vibeLabel("party"), "Here to party 🎉");
    assert.equal(vibe.vibeLabel(""), "");
    assert.equal(vibe.vibePublic("going_sober").vibeLabel, "Going sober 💧");
    assert.deepEqual(vibe.vibePublic(""), { vibe: "", vibeLabel: "" });
  });

  test("module copy stays within Apple guideline 1.4.3 wording", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/vibe.js"), "utf8");
    const forbidden = [
      "💊", "🍃", "🌿", "🍁", "💉", "weed", "molly", "cocaine", "coke", "ketamine",
      "mdma", "lsd", "shroom", "pill", "drugs", "high", "dose", "rolling",
    ];
    for (const word of forbidden) {
      assert.equal(src.toLowerCase().includes(word.toLowerCase()), false, "forbidden term in vibe.js: " + word);
    }
    assert.match(src, /Going sober/);
    assert.match(src, /Sober-friendly/);
    assert.match(src, /Here to party/);
    assert.match(src, /💧/);
    assert.match(src, /🎉/);
  });
});

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-vibe-"));
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

function insertShow(dbPath, id, key, name) {
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.prepare(`
    INSERT INTO events (id, event_key, name, city, date_label, venue, genres, artists, emoji, color, is_example, category, starts_at, ends_at, status, time_tba)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,'rave',?,?,'active',0)
  `).run(
    id, key || (id + "-key"), name || "Yheti", "Salt Lake City", "Sat, Mar 20, 2027 · 10:00 PM", "The Complex",
    "[]", '["Yheti"]', "🎧", "", "2027-03-20T22:00:00-06:00", "2027-03-21T02:00:00-06:00"
  );
  raw.close();
}

describe("show vibe API", () => {
  let srv;
  before(async () => {
    srv = startServer();
    await srv.ready;
    insertShow(srv.dbPath, "vibe-test-yheti", "vibe-yheti-2027", "Yheti");
    insertShow(srv.dbPath, "vibe-test-other", "vibe-other-2027", "Desert Lights");
    const raw = new DatabaseSync(srv.dbPath);
    const cols = raw.prepare("PRAGMA table_info(event_going)").all().map((c) => c.name);
    raw.close();
    assert.ok(cols.includes("show_vibe"), "vibe_migrate should add show_vibe to event_going");
  });
  after(() => srv && srv.stop());

  test("you can set, change, and clear a vibe after marking going", async () => {
    const alice = client(srv.base);
    let r = await alice("POST", "/api/signup", signupBody("vibealice"));
    assert.equal(r.status, 200, r.data.error);

    r = await alice("POST", "/api/events/vibe-test-yheti/vibe", { vibe: "going_sober" });
    assert.equal(r.status, 400, "vibe requires going first");

    r = await alice("POST", "/api/events/vibe-test-yheti/going", { going: true, vibe: "going_sober" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.going, true);
    assert.equal(r.data.vibe, "going_sober");
    assert.equal(r.data.vibeLabel, "Going sober 💧");
    const show = (r.data.upcomingShows || []).find((s) => s.id === "vibe-test-yheti");
    assert.ok(show, "upcoming shows should include the RSVP");
    assert.equal(show.vibe, "going_sober");
    assert.equal(show.vibeLabel, "Going sober 💧");

    r = await alice("GET", "/api/events");
    assert.equal(r.status, 200);
    const ev = (r.data.events || []).find((e) => e.id === "vibe-test-yheti");
    assert.ok(ev);
    assert.equal(ev.imGoing, true);
    assert.equal(ev.imVibe, "going_sober");
    assert.equal(ev.imVibeLabel, "Going sober 💧");
    const me = (ev.going || []).find((p) => p.username === "vibealice");
    assert.ok(me);
    assert.equal(me.vibe, "going_sober");
    assert.equal(me.vibeLabel, "Going sober 💧");

    r = await alice("POST", "/api/events/vibe-test-yheti/vibe", { vibe: "party" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.vibe, "party");
    assert.equal(r.data.vibeLabel, "Here to party 🎉");

    r = await alice("POST", "/api/events/vibe-test-yheti/vibe", { vibe: "" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.vibe, "");
    assert.equal(r.data.vibeLabel, "");
    const cleared = (r.data.upcomingShows || []).find((s) => s.id === "vibe-test-yheti");
    assert.ok(cleared);
    assert.ok(!cleared.vibe, "blank vibe is omitted or empty on the profile list");

    r = await alice("POST", "/api/events/vibe-test-yheti/vibe", { vibe: "not-a-real-vibe" });
    assert.equal(r.status, 400);

    r = await alice("GET", "/api/me");
    const mine = ((r.data.user && r.data.user.upcomingShows) || r.data.upcomingShows || []).find((s) => s.id === "vibe-test-yheti");
    assert.ok(mine);
    assert.ok(!mine.vibe);
  });

  test("Discover can filter by vibe for free, including on iOS", async () => {
    const alice = client(srv.base);
    const bob = client(srv.base);
    const cara = client(srv.base);
    let r = await alice("POST", "/api/login", { username: "vibealice", password: "test-pass-123" });
    if (r.status !== 200) r = await alice("POST", "/api/signup", signupBody("vibealice"));
    r = await bob("POST", "/api/signup", signupBody("vibebob"));
    assert.equal(r.status, 200, r.data.error);
    r = await cara("POST", "/api/signup", signupBody("vibecara"));
    assert.equal(r.status, 200, r.data.error);

    await alice("POST", "/api/events/vibe-test-yheti/going", { going: true, vibe: "going_sober" });
    await bob("POST", "/api/events/vibe-test-yheti/going", { going: true, vibe: "going_sober" });
    await cara("POST", "/api/events/vibe-test-yheti/going", { going: true, vibe: "party" });

    r = await alice("GET", "/api/discover?vibe=going_sober");
    assert.equal(r.status, 200, r.data.error);
    const people = r.data.people || [];
    assert.ok(people.some((p) => p.username === "vibebob"), "bob is going sober");
    assert.ok(!people.some((p) => p.username === "vibecara"), "cara is here to party, not going sober");
    const bobCard = people.find((p) => p.username === "vibebob");
    const bobShow = (bobCard.upcomingShows || []).find((s) => s.id === "vibe-test-yheti");
    assert.ok(bobShow);
    assert.equal(bobShow.vibe, "going_sober");
    assert.equal(bobShow.vibeLabel, "Going sober 💧");

    r = await alice("GET", "/api/discover?vibe=going_sober", undefined, { "x-kandi-client": "ios" });
    assert.equal(r.status, 200);
    assert.ok((r.data.people || []).some((p) => p.username === "vibebob"), "vibe filter stays free on iOS");

    r = await bob("GET", "/api/users/" + (await alice("GET", "/api/me")).data.user.id);
    const profileShow = ((r.data.user && r.data.user.upcomingShows) || r.data.upcomingShows || []).find((s) => s.id === "vibe-test-yheti");
    assert.ok(profileShow);
    assert.equal(profileShow.vibe, "going_sober");
  });

  test("un-RSVP drops the vibe, and toggling going does not invent a tag", async () => {
    const bob = client(srv.base);
    let r = await bob("POST", "/api/login", { username: "vibebob", password: "test-pass-123" });
    assert.equal(r.status, 200, r.data.error);
    r = await bob("POST", "/api/events/vibe-test-yheti/going", { going: false });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.going, false);
    assert.equal(r.data.vibe || "", "");

    r = await bob("POST", "/api/events/vibe-test-yheti/going", { going: true });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.vibe || "", "", "marking going alone leaves the vibe blank");

    const anon = client(srv.base);
    r = await anon("POST", "/api/events/vibe-test-yheti/vibe", { vibe: "going_sober" });
    assert.equal(r.status, 401);
  });
});
