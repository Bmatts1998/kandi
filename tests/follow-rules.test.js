"use strict";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("follow rules", () => {
  let child, base, dir;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-follow-"));
    const port = 20000 + Math.floor(Math.random() * 20000);
    base = "http://127.0.0.1:" + port;
    const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: path.join(dir, "k.sqlite"), NODE_ENV: "production", KANDI_PUBLIC_URL: "https://kandi.example" };
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

  function client() {
    let cookie = "";
    return async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };
  }
  async function signup(name) {
    const c = client();
    const r = await c("POST", "/api/signup", { username: name, password: "pass-12345", name: "N " + name, age: 25, acceptedTerms: true, email: name + "@example.com" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { c, id: r.data.user.id };
  }

  test("no follow without match or link; link works; reset kills old link; toggle off blocks link", async () => {
    const a = await signup("fa_alice");
    const b = await signup("fa_bob");
    let r = await b.c("POST", `/api/users/${a.id}/follow`, {});
    assert.equal(r.status, 403);
    assert.equal(r.data.code, "follow_not_allowed");
    r = await a.c("GET", "/api/me/share-link");
    assert.match(r.data.url, /^https:\/\/kandi\.example\/u\/fa_alice\?k=[A-Za-z0-9_-]{16}$/);
    const k = new URL(r.data.url).searchParams.get("k");
    // Logged-out preview works with the token only.
    const anon = client();
    assert.equal((await anon("GET", "/api/share/fa_alice?k=" + k)).status, 200);
    assert.equal((await anon("GET", "/api/share/fa_alice?k=wrong")).status, 404);
    const card = (await anon("GET", "/api/share/fa_alice?k=" + k)).data.profile;
    assert.ok(!("email" in card) && !("bio" in card), "limited card only");
    r = await b.c("POST", `/api/users/${a.id}/follow`, { k: "nope" });
    assert.equal(r.status, 403);
    r = await b.c("POST", `/api/users/${a.id}/follow`, { k });
    assert.equal(r.status, 200);
    assert.equal(r.data.following, true);
    // reset kills the old link for new people
    const c = await signup("fa_carl");
    await a.c("POST", "/api/me/share-link/reset", {});
    assert.equal((await c.c("POST", `/api/users/${a.id}/follow`, { k })).status, 403);
    // existing follower stays
    r = await b.c("GET", `/api/users/${a.id}`);
    assert.equal(r.data.user.following, true);
    // toggle off
    const k2 = new URL((await a.c("GET", "/api/me/share-link")).data.url).searchParams.get("k");
    await a.c("PUT", "/api/me/share-settings", { allowLinkFollows: false });
    assert.equal((await c.c("POST", `/api/users/${a.id}/follow`, { k: k2 })).status, 403);
    assert.equal((await anon("GET", "/api/share/fa_alice?k=" + k2)).status, 404);
    await a.c("PUT", "/api/me/share-settings", { allowLinkFollows: true });
    assert.equal((await c.c("POST", `/api/users/${a.id}/follow`, { k: k2 })).status, 200);
  });

  test("mutual match allows follow; block removes follows both ways and wins", async () => {
    const a = await signup("fm_ann");
    const b = await signup("fm_ben");
    await a.c("POST", "/api/like", { userId: b.id, targetType: "photo", targetId: "0" });
    const lk = await b.c("POST", "/api/like", { userId: a.id, targetType: "photo", targetId: "0" });
    assert.equal(lk.status, 200, JSON.stringify(lk.data));
    let r = await b.c("GET", `/api/users/${a.id}`);
    assert.equal(r.data.user.canFollow, true, JSON.stringify({ matched: r.data.user.matched }));
    assert.equal((await b.c("POST", `/api/users/${a.id}/follow`, {})).status, 200);
    assert.equal((await a.c("POST", `/api/users/${b.id}/follow`, {})).status, 200);
    await a.c("POST", "/api/block", { userId: b.id });
    r = await a.c("GET", `/api/users/${a.id}`);
    assert.equal(r.data.user.followerCount, 0);
    assert.equal(r.data.user.followingCount, 0);
    assert.equal((await b.c("POST", `/api/users/${a.id}/follow`, {})).status, 403);
  });

  test("crew tagging can't search strangers by name", async () => {
    const a = await signup("fc_owner");
    const g = await a.c("POST", "/api/groups", { name: "Test Crew", emoji: "🧡", joinMode: "public" });
    assert.equal(g.status, 200, JSON.stringify(g.data));
    const gid = g.data.group.id;
    const r = await a.c("GET", `/api/groups/${gid}/people?q=nova`);
    assert.equal(r.status, 200);
    assert.equal(r.data.people.length, 0, "nova is not connected to a brand-new user");
  });

  test("seeded demo follows are kept (grandfathered)", async () => {
    const c = client();
    await c("POST", "/api/login", { username: "nova", password: "plur-demo" });
    const r = await c("GET", "/api/feed/following");
    assert.equal(r.status, 200);
    const me = await c("GET", "/api/me");
    const prof = await c("GET", `/api/users/${me.data.user.id}`);
    assert.ok(prof.data.user.followingCount > 0);
  });
});
