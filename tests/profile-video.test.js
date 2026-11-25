"use strict";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let ffmpeg = null;
try { ffmpeg = require("ffmpeg-static"); } catch (_) {}

describe("profile videos", { skip: !ffmpeg && "ffmpeg-static missing" }, () => {
  let child, base, dir, clip, jpg;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-pvid-"));
    clip = path.join(dir, "clip.mp4");
    jpg = path.join(dir, "face.jpg");
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15", "-f", "lavfi", "-i", "sine=frequency=440",
      "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", clip]);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=400x400", "-frames:v", "1", jpg]);
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

  test("mixed media rules: photo first, 3-video cap, delete and reorder", async () => {
    let cookie = "";
    const keep = (r) => { const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; };
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      keep(r);
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };
    const send = async (url, fields) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, new Blob([fs.readFileSync(v.file)], { type: v.type }), path.basename(v.file));
      const r = await fetch(base + url, { method: "POST", headers: { Cookie: cookie }, body: fd });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };
    let r = await call("POST", "/api/signup", { username: "vid_tester", password: "pass-12345", name: "Vid", age: 25, acceptedTerms: true, email: "vid@example.com" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // Clear any default placeholder so we start with no photos.
    while ((r.data.user.media || []).length) r = await call("DELETE", "/api/me/photo/0", {});
    const video = { file: clip, type: "video/mp4" };
    r = await send("/api/me/video", { video });
    assert.equal(r.status, 400, "a video needs a photo first");
    assert.match(r.data.error, /photo first/i);
    r = await send("/api/me/photo", { photo: { file: jpg, type: "image/jpeg" } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    for (let i = 0; i < 3; i++) {
      r = await send("/api/me/video", { video });
      assert.equal(r.status, 200, JSON.stringify(r.data));
    }
    const u = r.data.user;
    assert.equal(u.photos.length, 1, "photos stays photos-only");
    assert.equal(u.media.length, 4);
    assert.equal(u.media[0].type, "file");
    const v = u.media[1];
    assert.equal(v.type, "video");
    assert.match(v.url, /^\/uploads\//);
    assert.ok(v.poster, "has a poster frame");
    assert.ok(v.duration >= 1 && v.duration <= 60);
    const vr = await fetch(base + v.url, { headers: { Cookie: cookie, Range: "bytes=0-99" } });
    assert.equal(vr.status, 206);
    assert.match(vr.headers.get("content-type"), /^video\//);
    const pr = await fetch(base + v.poster, { headers: { Cookie: cookie } });
    assert.equal(pr.status, 200);
    assert.match(pr.headers.get("content-type"), /^image\//);
    r = await send("/api/me/video", { video });
    assert.equal(r.status, 400, "cap of 3 videos");
    r = await call("PUT", "/api/me/photos", { order: [1, 0, 2, 3] });
    assert.equal(r.status, 400, "slot 1 must stay a photo");
    r = await call("POST", "/api/me/photo/main", { index: 1 });
    assert.equal(r.status, 400, "a video can't be main");
    r = await call("PUT", "/api/me/photos", { order: [0, 3, 1, 2] });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.media[1].url, u.media[3].url);
    r = await call("DELETE", "/api/me/photo/0", {});
    assert.equal(r.status, 400, "can't delete the last photo while videos exist");
    r = await call("DELETE", "/api/me/photo/1", {});
    assert.equal(r.status, 200);
    assert.equal(r.data.user.media.length, 3);
    const gone = await fetch(base + u.media[3].url, { headers: { Cookie: cookie } });
    assert.equal(gone.status, 404, "deleted video file is gone");
    const goneP = await fetch(base + u.media[3].poster, { headers: { Cookie: cookie } });
    assert.equal(goneP.status, 404, "and its poster");
    // Others see the videos in media, never in photos.
    const meId = r.data.user.id;
    cookie = "";
    r = await call("POST", "/api/login", { username: "nova", password: "plur-demo" });
    assert.equal(r.status, 200);
    r = await call("GET", "/api/users/" + meId);
    assert.equal(r.status, 200);
    assert.equal(r.data.user.photos.length, 1);
    assert.equal(r.data.user.media.filter((m) => m.type === "video").length, 2);
    // Blocking hides the profile, videos included, like photos.
    r = await call("POST", "/api/block", { userId: meId });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await call("GET", "/api/users/" + meId);
    assert.equal(r.status, 404);
  });
});
