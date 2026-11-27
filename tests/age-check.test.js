"use strict";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ageCheck = require("../src/age-check");

function startServer(extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-age-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: path.join(dir, "k.sqlite"), SEED_ON_BOOT: "0", ...extraEnv };
  delete env.DATABASE_URL;
  for (const k of ["RENDER", "RENDER_SERVICE_ID", "RENDER_GIT_COMMIT", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "GMAIL_REFRESH_TOKEN", "EMAIL_PROVIDER", "EMAIL_VERIFICATION", "KANDI_PUBLIC_URL"]) {
    if (!(k in (extraEnv || {}))) delete env[k];
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
  return { child, base, ready, log: () => out, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function client(base) {
  const jar = new Map();
  function cookieHeader() {
    return Array.from(jar.entries()).map(([k, v]) => k + "=" + v).join("; ");
  }
  return async function call(method, url, body) {
    const headers = { "Content-Type": "application/json" };
    const existing = cookieHeader();
    if (existing) headers.Cookie = existing;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    for (const line of raw) {
      const pair = String(line || "").split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

function signupBody(username) {
  return { username, password: "test-pass-123", name: "Tester", age: 25, acceptedTerms: true, email: username + "@example.com", meetIntent: "both" };
}

describe("age-check helpers", () => {
  test("maps Apple sharing results from the lower bound", () => {
    assert.equal(ageCheck.resolveSubmission({ status: "sharing", lowerBound: 18 }).status, "over18");
    assert.equal(ageCheck.resolveSubmission({ status: "sharing", lowerBound: 18, upperBound: null }).lower, 18);
    assert.equal(ageCheck.resolveSubmission({ status: "sharing" }).status, "under18");
    assert.equal(ageCheck.resolveSubmission({ status: "sharing", upperBound: 17 }).status, "under18");
    assert.equal(ageCheck.resolveSubmission({ status: "over18" }).error, "An 18+ result must include the age range Apple returned.");
  });

  test("accepts declined and unavailable without blocking", () => {
    assert.equal(ageCheck.resolveSubmission({ status: "declined" }).status, "declined");
    assert.equal(ageCheck.resolveSubmission({ status: "declinedSharing" }).status, "declined");
    assert.equal(ageCheck.resolveSubmission({ status: "unavailable", reason: "ios_version" }).status, "unavailable");
    assert.equal(ageCheck.resolveSubmission({ status: "not_available" }).status, "unavailable");
    assert.ok(ageCheck.resolveSubmission({ status: "nope" }).error);
  });

  test("needsCheck is true until a real share or decline is stored", () => {
    assert.equal(ageCheck.publicAgeCheck({}).needsCheck, true);
    assert.equal(ageCheck.publicAgeCheck({ age_check_status: "unavailable" }).needsCheck, true);
    assert.equal(ageCheck.publicAgeCheck({ age_check_status: "declined" }).needsCheck, false);
    assert.equal(ageCheck.publicAgeCheck({ age_check_status: "over18" }).needsCheck, false);
    assert.equal(ageCheck.publicAgeCheck({ age_check_status: "under18" }).needsCheck, false);
  });
});

describe("age-check API", () => {
  let srv;
  before(async () => { srv = startServer({ NODE_ENV: "production" }); await srv.ready; });
  after(() => srv && srv.stop());

  test("new accounts start with no Apple age check, and the web client is unchanged", async () => {
    const call = client(srv.base);
    const r = await call("POST", "/api/signup", signupBody("ageweb1"));
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.user.ageCheck.status, null);
    assert.equal(r.data.user.ageCheck.needsCheck, true);
  });

  test("requires sign-in", async () => {
    const call = client(srv.base);
    const r = await call("POST", "/api/age-check", { status: "unavailable" });
    assert.equal(r.status, 401);
  });

  test("stores over18 from a shared 18+ range", async () => {
    const call = client(srv.base);
    let r = await call("POST", "/api/signup", signupBody("ageover1"));
    assert.equal(r.status, 200, r.data.error);
    r = await call("POST", "/api/age-check", { status: "sharing", lowerBound: 18, declaration: "selfDeclared" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.ageCheck.status, "over18");
    assert.equal(r.data.blocked, false);
    const me = await call("GET", "/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.ageCheck.status, "over18");
    assert.equal(me.data.user.ageCheck.declaration, "selfDeclared");
    assert.equal(me.data.user.ageCheck.needsCheck, false);
  });

  test("declined and unavailable keep the account usable", async () => {
    const call = client(srv.base);
    let r = await call("POST", "/api/signup", signupBody("agedecl1"));
    assert.equal(r.status, 200, r.data.error);
    r = await call("POST", "/api/age-check", { status: "declined" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.ageCheck.status, "declined");
    assert.equal((await call("GET", "/api/me")).status, 200);

    const call2 = client(srv.base);
    r = await call2("POST", "/api/signup", signupBody("ageunav1"));
    assert.equal(r.status, 200, r.data.error);
    r = await call2("POST", "/api/age-check", { status: "unavailable", reason: "ios_version" });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.ageCheck.status, "unavailable");
    assert.equal(r.data.ageCheck.needsCheck, true);
    assert.equal((await call2("GET", "/api/me")).status, 200);
  });

  test("under18 blocks the account but still allows me, logout, and a later over18 recheck", async () => {
    const call = client(srv.base);
    let r = await call("POST", "/api/signup", signupBody("ageunder1"));
    assert.equal(r.status, 200, r.data.error);
    r = await call("POST", "/api/age-check", { status: "sharing", upperBound: 17 });
    assert.equal(r.status, 403);
    assert.equal(r.data.code, "age_blocked");
    assert.equal(r.data.ageCheck.status, "under18");
    assert.equal(r.data.blocked, true);

    const me = await call("GET", "/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.ageCheck.status, "under18");

    const denied = await call("PUT", "/api/me", { bio: "should not save" });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code, "age_blocked");

    const login = client(srv.base);
    const loggedIn = await login("POST", "/api/login", { username: "ageunder1", password: "test-pass-123" });
    assert.equal(loggedIn.status, 200);
    assert.equal(loggedIn.data.user.ageCheck.status, "under18");
    const stillDenied = await login("PUT", "/api/me", { bio: "nope" });
    assert.equal(stillDenied.status, 403);

    const lifted = await login("POST", "/api/age-check", { status: "sharing", lowerBound: 18, declaration: "selfDeclared" });
    assert.equal(lifted.status, 200, lifted.data.error);
    assert.equal(lifted.data.ageCheck.status, "over18");
    assert.equal((await login("PUT", "/api/me", { bio: "now allowed" })).status, 200);
  });
});
