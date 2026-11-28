"use strict";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { parseDesign, MAX_DESIGNS, BEAD_MAX } = require("../src/kandi-design");

const BASE5 = ["#ff5c00", "#ff8a1a", "#ffc14d", "#fff7f0", "#111111"];

describe("kandi design validation", () => {
  test("legacy designs without shapes/pattern/charm still validate", () => {
    const r = parseDesign({ style: "sunset", beads: BASE5, word: "plur", message: "hi" });
    assert.ok(r.design, JSON.stringify(r));
    assert.deepEqual(r.design.shapes, ["round", "round", "round", "round", "round"]);
    assert.equal(r.design.pattern, "custom");
    assert.equal(r.design.charm, "none");
  });

  test("shapes, pattern, charm, and new finishes are accepted and normalized", () => {
    const r = parseDesign({ style: "neon", beads: BASE5.concat(["#39ff14"]), shapes: ["star", "heart", "pony", "cube", "flower", "nope"], pattern: "alternating", charm: "bolt", word: "ab" });
    assert.ok(r.design);
    assert.deepEqual(r.design.shapes, ["star", "heart", "pony", "cube", "flower", "round"]);
    assert.equal(r.design.pattern, "alternating");
    assert.equal(r.design.charm, "bolt");
    assert.equal(r.design.style, "neon");
    for (const style of ["pastel", "glitter", "jelly"]) assert.ok(parseDesign({ style, beads: BASE5 }).design);
  });

  test("unknown pattern/charm fall back; bad style, short or invalid bead lists are rejected", () => {
    const r = parseDesign({ style: "classic", beads: BASE5, pattern: "zigzag", charm: "skull" });
    assert.equal(r.design.pattern, "custom");
    assert.equal(r.design.charm, "none");
    assert.ok(parseDesign({ style: "lava", beads: BASE5 }).error);
    assert.ok(parseDesign({ style: "classic", beads: BASE5.slice(0, 3) }).error);
    assert.ok(parseDesign({ style: "classic", beads: ["red", "blue", "green", "x", "y", "z"] }).error);
    assert.ok(parseDesign("not json").error);
    assert.ok(parseDesign([1, 2]).error);
  });

  test("bead count caps at the max and the word keeps its 8 letter limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => (i % 2 ? "#ff5c00" : "#2ef0ff"));
    const r = parseDesign({ style: "classic", beads: many, shapes: many.map(() => "heart"), word: "abcdefghijkl" });
    assert.equal(r.design.beads.length, BEAD_MAX);
    assert.equal(r.design.shapes.length, BEAD_MAX);
    assert.equal(r.design.word, "ABCDEFGH");
  });
});

describe("My designs + trading with saved designs API", () => {
  let child, base, dir;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-designs-"));
    const port = 20000 + Math.floor(Math.random() * 20000);
    base = "http://127.0.0.1:" + port;
    const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", KANDI_SQLITE_PATH: path.join(dir, "k.sqlite"), NODE_ENV: "production", KANDI_PUBLIC_URL: "https://kandi.example" };
    delete env.DATABASE_URL;
    child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(out || "server start timeout")), 60000);
      const iv = setInterval(() => { if (/listening on/.test(out)) { clearInterval(iv); clearTimeout(t); resolve(); } }, 100);
    });
  });
  after(() => { child && child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

  function client() {
    let cookie = "";
    return async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const list = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : String(r.headers.get("set-cookie") || "").split(/,(?=\s*kandi_)/);
      for (const c of list) if (/^kandi_sid=/i.test(String(c).trim())) cookie = String(c).trim().split(";")[0];
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };
  }
  async function signup(name) {
    const c = client();
    const r = await c("POST", "/api/signup", { username: name, password: "pass-12345", name: "N " + name, age: 25, acceptedTerms: true, email: name + "@example.com" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { c, id: r.data.user.id };
  }
  const tag = () => Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 99);
  function d(word, extra) {
    return Object.assign({ style: "neon", beads: BASE5.concat(["#39ff14", "#00f0ff"]), shapes: ["star", "heart", "round", "pony", "cube", "flower", "round"], pattern: "custom", charm: "star", word, message: "" }, extra || {});
  }

  test("requires login", async () => {
    const r = await fetch(base + "/api/kandi-designs");
    assert.equal(r.status, 401);
  });

  test("create, list, rename/edit, duplicate, delete; owner only; validation", async () => {
    const a = await signup("kd_a_" + tag());
    const b = await signup("kd_b_" + tag());
    const empty = await a.c("GET", "/api/kandi-designs");
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.data.designs, []);
    assert.equal(empty.data.max, MAX_DESIGNS);

    const bad = await a.c("POST", "/api/kandi-designs", { name: "x", design: { style: "classic", beads: ["#fff"] } });
    assert.equal(bad.status, 400);

    const made = await a.c("POST", "/api/kandi-designs", { name: "  Festival   kandi  ", design: d("PLUR") });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    assert.equal(made.data.item.name, "Festival kandi");
    assert.equal(made.data.item.design.charm, "star");
    assert.equal(made.data.item.design.shapes[0], "star");
    const id = made.data.item.id;

    const upd = await a.c("PUT", "/api/kandi-designs/" + id, { name: "Rail kandi", design: d("RAIL", { charm: "moon" }) });
    assert.equal(upd.status, 200, JSON.stringify(upd.data));
    assert.equal(upd.data.item.name, "Rail kandi");
    assert.equal(upd.data.item.design.word, "RAIL");
    assert.equal(upd.data.item.design.charm, "moon");
    const renameOnly = await a.c("PUT", "/api/kandi-designs/" + id, { name: "Just a name" });
    assert.equal(renameOnly.data.item.design.word, "RAIL");

    const dup = await a.c("POST", "/api/kandi-designs/" + id + "/duplicate", {});
    assert.equal(dup.status, 201, JSON.stringify(dup.data));
    assert.equal(dup.data.item.name, "Just a name copy");
    assert.notEqual(dup.data.item.id, id);
    assert.equal(dup.data.designs.length, 2);

    // other users can't see, edit, duplicate, or delete it
    assert.equal((await b.c("GET", "/api/kandi-designs")).data.designs.length, 0);
    assert.equal((await b.c("PUT", "/api/kandi-designs/" + id, { name: "mine now" })).status, 404);
    assert.equal((await b.c("POST", "/api/kandi-designs/" + id + "/duplicate", {})).status, 404);
    await b.c("DELETE", "/api/kandi-designs/" + id);
    assert.equal((await a.c("GET", "/api/kandi-designs")).data.designs.length, 2);

    const del = await a.c("DELETE", "/api/kandi-designs/" + id);
    assert.equal(del.status, 200);
    assert.equal(del.data.designs.length, 1);
  });

  test("library is capped", async () => {
    const a = await signup("kd_cap_" + tag());
    for (let i = 0; i < MAX_DESIGNS; i++) {
      const r = await a.c("POST", "/api/kandi-designs", { name: "k" + i, design: d("K" + i) });
      assert.equal(r.status, 201, JSON.stringify(r.data));
    }
    const over = await a.c("POST", "/api/kandi-designs", { name: "one more", design: d("NOPE") });
    assert.equal(over.status, 400);
    assert.match(over.data.error, /up to 20/);
    const list = await a.c("GET", "/api/kandi-designs");
    assert.equal(list.data.designs.length, MAX_DESIGNS);
    const dup = await a.c("POST", "/api/kandi-designs/" + list.data.designs[0].id + "/duplicate", {});
    assert.equal(dup.status, 400);
  });

  test("trade with a saved design: snapshot copy, shapes/charm kept, last used tracked, later edits don't change past trades", async () => {
    const a = await signup("kd_ta_" + tag());
    const b = await signup("kd_tb_" + tag());
    const made = await a.c("POST", "/api/kandi-designs", { name: "Main", design: d("PLUR") });
    const savedId = made.data.item.id;
    assert.equal((await a.c("GET", "/api/kandi-designs")).data.lastUsedId, "");

    const offer = (await a.c("POST", "/api/trades/offers", {})).data.offer;
    const joined = await b.c("POST", "/api/trades/offers/" + offer.code + "/join", {});
    assert.equal(joined.status, 200);
    // A readies by saved id only (no design body): the server uses its own copy.
    const ra = await a.c("POST", "/api/trades/offers/" + offer.id + "/ready", { designId: savedId, message: "see you at rail" });
    assert.equal(ra.status, 200, JSON.stringify(ra.data));
    assert.deepEqual(ra.data.saved, { id: savedId });
    // B designs on the spot and saves it at the same time.
    const rb = await b.c("POST", "/api/trades/offers/" + offer.id + "/ready", { design: d("RAVE", { charm: "gem", pattern: "alternating" }), saveAs: "On the spot" });
    assert.equal(rb.status, 200, JSON.stringify(rb.data));
    assert.equal(rb.data.completed, true);
    assert.equal(rb.data.saved.name, "On the spot");

    const la = await a.c("GET", "/api/kandi-designs");
    assert.equal(la.data.lastUsedId, savedId);
    const lb = await b.c("GET", "/api/kandi-designs");
    assert.equal(lb.data.designs.length, 1);
    assert.equal(lb.data.lastUsedId, lb.data.designs[0].id);

    const colB = (await b.c("GET", "/api/trades/collection")).data.items[0];
    assert.equal(colB.word, "PLUR");
    assert.equal(colB.message, "see you at rail");
    assert.equal(colB.charm, "star");
    assert.equal(colB.shapes[0], "star");
    assert.equal(colB.shapes[3], "pony");
    assert.equal(colB.style, "neon");
    const colA = (await a.c("GET", "/api/trades/collection")).data.items[0];
    assert.equal(colA.charm, "gem");
    assert.equal(colA.pattern, "alternating");

    // Edit then delete the saved design: the traded copy B holds is untouched.
    const edit = await a.c("PUT", "/api/kandi-designs/" + savedId, { design: d("CHANGED", { charm: "crown", shapes: ["heart", "heart", "heart", "heart", "heart", "heart", "heart"] }) });
    assert.equal(edit.status, 200);
    await a.c("DELETE", "/api/kandi-designs/" + savedId);
    const after = (await b.c("GET", "/api/trades/collection")).data.items[0];
    assert.equal(after.word, "PLUR");
    assert.equal(after.charm, "star");
    assert.equal(after.shapes[0], "star");
    const detail = (await b.c("GET", "/api/trades/items/" + after.id)).data.item;
    assert.equal(detail.word, "PLUR");
    assert.equal(detail.charm, "star");
  });

  test("ready rejects a saved design id the user doesn't own, and still accepts plain legacy designs", async () => {
    const a = await signup("kd_ra_" + tag());
    const b = await signup("kd_rb_" + tag());
    const c = await signup("kd_rc_" + tag());
    const theirs = await c.c("POST", "/api/kandi-designs", { name: "Carl's", design: d("CARL") });
    const offer = (await a.c("POST", "/api/trades/offers", {})).data.offer;
    await b.c("POST", "/api/trades/offers/" + offer.code + "/join", {});
    const steal = await a.c("POST", "/api/trades/offers/" + offer.id + "/ready", { designId: theirs.data.item.id });
    assert.equal(steal.status, 404);
    const legacy = await a.c("POST", "/api/trades/offers/" + offer.id + "/ready", { design: { style: "classic", beads: BASE5, word: "OLD", message: "" } });
    assert.equal(legacy.status, 200, JSON.stringify(legacy.data));
    assert.equal(legacy.data.saved, null);
  });

  test("deleting an account removes saved designs", async () => {
    const name = "kd_del_" + tag();
    const a = await signup(name);
    await a.c("POST", "/api/kandi-designs", { name: "gone", design: d("BYE") });
    const r = await a.c("DELETE", "/api/account", { username: name, confirm: "DELETE" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const db = new DatabaseSync(path.join(dir, "k.sqlite"));
    const n = db.prepare("SELECT COUNT(*) AS n FROM kandi_designs WHERE user_id=?").get(a.id).n;
    db.close();
    assert.equal(n, 0);
  });
});
