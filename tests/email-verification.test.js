"use strict";

// Spins up the real server on a throwaway SQLite file and walks the email flows.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mailer = require("../src/email");

function startServer(extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-email-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: path.join(dir, "k.sqlite"), SEED_ON_BOOT: "1", ...extraEnv };
  delete env.DATABASE_URL;
  for (const k of ["RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "GMAIL_REFRESH_TOKEN", "EMAIL_PROVIDER", "EMAIL_VERIFICATION", "KANDI_PUBLIC_URL"]) if (!(k in extraEnv)) delete env[k];
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
  let cookie = "";
  return async function call(method, url, body) {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

function signupBody(username, email) {
  return { username, password: "test-pass-123", name: "Tester", age: 25, acceptedTerms: true, email };
}

describe("email helpers", () => {
  test("validates and normalizes email", () => {
    assert.equal(mailer.validateEmail("  Foo.Bar@Example.COM ").value, "foo.bar@example.com");
    assert.ok(mailer.validateEmail("nope").error);
    assert.ok(mailer.validateEmail("a@b").error);
    assert.ok(mailer.validateEmail("").error);
  });
  test("provider detection is env-gated", () => {
    assert.equal(mailer.detectProvider({ NODE_ENV: "production" }), "none");
    assert.equal(mailer.verificationActive({ NODE_ENV: "production" }), false);
    assert.equal(mailer.detectProvider({ NODE_ENV: "production", RESEND_API_KEY: "x" }), "resend");
    assert.equal(mailer.verificationActive({ NODE_ENV: "production", RESEND_API_KEY: "x", EMAIL_VERIFICATION: "off" }), false);
    assert.equal(mailer.detectProvider({}), "console");
  });
  test("grandfathered accounts are never locked", () => {
    const env = { RESEND_API_KEY: "x" };
    assert.equal(mailer.isLocked({ email_verify_required: 0 }, env), false);
    assert.equal(mailer.isLocked({ email_verify_required: 1, email_verified_at: "2026-01-01" }, env), false);
    assert.equal(mailer.isLocked({ email_verify_required: 1 }, env), true);
    assert.equal(mailer.isLocked({ email_verify_required: 1 }, { NODE_ENV: "production" }), false);
  });
});

describe("production with no email provider (today's live setup)", () => {
  let srv;
  before(async () => { srv = startServer({ NODE_ENV: "production" }); await srv.ready; });
  after(() => srv && srv.stop());

  test("sign-up requires a valid, unique email but does not lock the account", async () => {
    const call = client(srv.base);
    const cfg = await call("GET", "/api/auth/config");
    assert.deepEqual(cfg.data, { emailRequired: true, emailVerification: false, passwordReset: false });
    let r = await call("POST", "/api/signup", signupBody("noemail1"));
    assert.equal(r.status, 400);
    assert.match(r.data.error, /email/i);
    r = await call("POST", "/api/signup", signupBody("bademail1", "not-an-email"));
    assert.equal(r.status, 400);
    r = await call("POST", "/api/signup", signupBody("prod_user1", "Prod@Example.com"));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.user.email, "prod@example.com");
    assert.equal(r.data.user.emailLocked, false);
    r = await call("GET", "/api/discover");
    assert.equal(r.status, 200);
    const other = client(srv.base);
    r = await other("POST", "/api/signup", signupBody("prod_user2", "PROD@example.com"));
    assert.equal(r.status, 409);
  });

  test("demo/seeded accounts log in and work without an email", async () => {
    const call = client(srv.base);
    const r = await call("POST", "/api/login", { username: "nova", password: "plur-demo" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.user.emailLocked, false);
    assert.equal((await call("GET", "/api/discover")).status, 200);
  });

  test("verification pages are served", async () => {
    for (const p of ["/verify-email", "/reset-password"]) {
      const res = await fetch(srv.base + p);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /account-pages\.js/);
    }
  });
});

describe("verification on (dev console provider)", () => {
  let srv;
  before(async () => { srv = startServer({ NODE_ENV: "development", EMAIL_PROVIDER: "console", KANDI_PUBLIC_URL: "https://kandi.test" }); await srv.ready; });
  after(() => srv && srv.stop());

  function lastLink(kind) {
    const re = new RegExp("https://kandi\\.test/" + kind + "\\?token=([a-f0-9]{64})", "g");
    const all = [...srv.log().matchAll(re)];
    return all.length ? all[all.length - 1][1] : null;
  }

  test("new account is locked until the link is used, and hidden from discover", async () => {
    const call = client(srv.base);
    let r = await call("POST", "/api/signup", signupBody("fresh_one", "fresh@example.com"));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.user.emailLocked, true);
    assert.equal(r.data.emailSent, true);
    r = await call("GET", "/api/discover");
    assert.equal(r.status, 403);
    assert.equal(r.data.code, "email_unverified");
    r = await call("GET", "/api/me");
    assert.equal(r.status, 200);
    assert.equal(r.data.user.emailLocked, true);
    assert.equal(r.data.user.email, "fresh@example.com");

    // Not visible to others while locked.
    const demo = client(srv.base);
    await demo("POST", "/api/login", { username: "orion", password: "plur-demo" }); // nova + hex auto-like new sign-ups, so they would hide them anyway
    let d = await demo("GET", "/api/discover");
    assert.ok(!d.data.people.some((p) => p.username === "fresh_one"));
    assert.ok(!d.data.people.some((p) => "email" in p), "email must never leak in public profiles");

    // Resend is rate-limited.
    r = await call("POST", "/api/email/resend", {});
    assert.equal(r.status, 429);

    const token = lastLink("verify-email");
    assert.ok(token);
    r = await client(srv.base)("POST", "/api/email/verify", { token });
    assert.equal(r.status, 200);
    r = await client(srv.base)("POST", "/api/email/verify", { token });
    assert.equal(r.status, 404, "single use");
    r = await call("GET", "/api/discover");
    assert.equal(r.status, 200);
    d = await demo("GET", "/api/discover");
    assert.ok(d.data.people.some((p) => p.username === "fresh_one"));
  });

  test("seeded accounts stay unlocked and can add an email later", async () => {
    const call = client(srv.base);
    let r = await call("POST", "/api/login", { username: "hex", password: "plur-demo" });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.emailLocked, false);
    r = await call("POST", "/api/me/email", { email: "hex@example.com" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.user.emailVerified, false);
    assert.equal(r.data.user.emailLocked, false);
    assert.equal((await call("GET", "/api/discover")).status, 200);
  });

  test("unverified user can still delete their account", async () => {
    const call = client(srv.base);
    await call("POST", "/api/signup", signupBody("del_me", "del@example.com"));
    const r = await call("DELETE", "/api/account", { username: "del_me", confirm: "DELETE" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });

  test("forgot + reset password by email", async () => {
    const call = client(srv.base);
    await call("POST", "/api/signup", signupBody("reset_me", "reset@example.com"));
    let r = await client(srv.base)("POST", "/api/password/forgot", { login: "RESET@example.com" });
    assert.equal(r.status, 200);
    const token = lastLink("reset-password");
    assert.ok(token);
    r = await client(srv.base)("POST", "/api/password/reset", { token, password: "short" });
    assert.equal(r.status, 400);
    r = await client(srv.base)("POST", "/api/password/reset", { token, password: "brand-new-pass" });
    assert.equal(r.status, 200);
    r = await client(srv.base)("POST", "/api/password/reset", { token, password: "brand-new-pass" });
    assert.equal(r.status, 410, "single use");
    // Old session revoked; new password works and the email counts as confirmed.
    assert.equal((await call("GET", "/api/me")).status, 401);
    const fresh = client(srv.base);
    r = await fresh("POST", "/api/login", { username: "reset_me", password: "brand-new-pass" });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.emailLocked, false);
    // Unknown accounts get the same answer.
    r = await client(srv.base)("POST", "/api/password/forgot", { login: "nobody@example.com" });
    assert.equal(r.status, 200);
  });
});
