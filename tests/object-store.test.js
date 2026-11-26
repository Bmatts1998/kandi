"use strict";
const { test, describe, after } = require("node:test");
const assert = require("node:assert");

const KEYS = [
  "KANDI_S3_ENDPOINT", "KANDI_S3_BUCKET", "KANDI_S3_ACCESS_KEY_ID",
  "KANDI_S3_SECRET_ACCESS_KEY", "KANDI_S3_REGION", "KANDI_S3_PUBLIC_BASE_URL",
  "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
];
const saved = {};
for (const k of KEYS) saved[k] = process.env[k];
function clear() { for (const k of KEYS) delete process.env[k]; }
function restore() { for (const k of KEYS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } }
after(restore);

describe("object-store stays off without credentials", () => {
  test("enabled() is false and clientConfig hides secrets", () => {
    clear();
    const store = require("../src/object-store");
    assert.equal(store.enabled(), false);
    const cfg = store.clientConfig();
    assert.deepEqual(cfg, { enabled: false, directUpload: false });
    assert.equal(JSON.stringify(cfg).includes("SECRET"), false);
  });
});

describe("object-store signs when configured", () => {
  test("presign put/get and key layout", () => {
    clear();
    process.env.KANDI_S3_ENDPOINT = "https://abc123.r2.cloudflarestorage.com";
    process.env.KANDI_S3_BUCKET = "kandi-media";
    process.env.KANDI_S3_ACCESS_KEY_ID = "AKIAEXAMPLE";
    process.env.KANDI_S3_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
    process.env.KANDI_S3_REGION = "auto";
    delete require.cache[require.resolve("../src/object-store")];
    const store = require("../src/object-store");
    assert.equal(store.enabled(), true);
    assert.deepEqual(store.clientConfig(), { enabled: true, directUpload: true });

    const photo = store.keyFor({ visibility: "public", kind: "photos", userId: 7, fileId: "abc.jpg" });
    assert.equal(photo, "public/photos/7/abc.jpg");
    const selfie = store.keyFor({ visibility: "private", kind: "selfies", userId: 7, fileId: "s1.jpg" });
    assert.equal(selfie, "private/selfies/7/s1.jpg");
    assert.equal(store.isPrivateKey(selfie), true);
    assert.equal(store.isPrivateKey(photo), false);
    assert.equal(store.keyOwnedBy(photo, { userId: 7, kind: "photos" }), true);
    assert.equal(store.keyOwnedBy(photo, { userId: 8, kind: "photos" }), false);
    assert.equal(store.keyOwnedBy(selfie, { userId: 7, kind: "selfies" }), true);

    const put = store.presignPut(photo, { contentType: "image/jpeg", expires: 600 });
    assert.equal(put.method, "PUT");
    assert.match(put.url, /^https:\/\/abc123\.r2\.cloudflarestorage\.com\/kandi-media\/public\/photos\/7\/abc\.jpg\?/);
    assert.match(put.url, /X-Amz-Signature=/);
    assert.match(put.url, /X-Amz-Credential=/);
    assert.equal(put.headers["Content-Type"], "image/jpeg");

    const get = store.presignGet(photo);
    assert.equal(get.method, "GET");
    assert.equal(get.public, false);
    assert.match(get.url, /X-Amz-Signature=/);

    const priv = store.presignGet(selfie, { expires: 120 });
    assert.equal(priv.public, false);
    assert.match(priv.url, /private\/selfies\/7\/s1\.jpg/);
    assert.ok(priv.expires <= 120);

    process.env.KANDI_S3_PUBLIC_BASE_URL = "https://media.example.com";
    delete require.cache[require.resolve("../src/object-store")];
    const store2 = require("../src/object-store");
    const pub = store2.presignGet(photo);
    assert.equal(pub.public, true);
    assert.equal(pub.url, "https://media.example.com/public/photos/7/abc.jpg");
    const stillPriv = store2.presignGet(selfie);
    assert.equal(stillPriv.public, false);
    assert.match(stillPriv.url, /X-Amz-Signature=/);
  });
});
