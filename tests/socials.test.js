"use strict";
const test = require("node:test");
const assert = require("node:assert");
const s = require("../src/socials");

test("instagram handles and links normalize to a handle", () => {
  for (const [input, out] of [["@Rave.Girl_1", "rave.girl_1"], ["rave.girl_1", "rave.girl_1"], ["https://www.instagram.com/Rave.Girl_1/?hl=en", "rave.girl_1"], ["instagram.com/ravegirl", "ravegirl"], ["", ""]]) {
    assert.deepStrictEqual(s.normalizeInstagram(input), { value: out }, input);
  }
  for (const bad of ["javascript:alert(1)", "https://evil.com/ravegirl", "https://instagram.com.evil.com/x", "https://www.instagram.com/p/abc123/", "bad handle!", "data:text/html,hi"]) {
    assert.ok(s.normalizeInstagram(bad).error, bad);
  }
  assert.strictEqual(s.instagramUrl("ravegirl"), "https://www.instagram.com/ravegirl/");
});

test("facebook usernames, profile.php ids, and links normalize", () => {
  for (const [input, out] of [["Boston.Mattsson", "boston.mattsson"], ["https://www.facebook.com/Boston.Mattsson", "boston.mattsson"], ["https://m.facebook.com/profile.php?id=1000123", "id:1000123"], ["fb.com/zuck", "zuck"], ["", ""]]) {
    assert.deepStrictEqual(s.normalizeFacebook(input), { value: out }, input);
  }
  for (const bad of ["javascript:alert(1)", "https://faceb00k.com/x", "https://www.facebook.com/groups/123", "no spaces allowed", "https://www.facebook.com/profile.php"]) {
    assert.ok(s.normalizeFacebook(bad).error, bad);
  }
  assert.strictEqual(s.facebookUrl("id:1000123"), "https://www.facebook.com/profile.php?id=1000123");
  assert.strictEqual(s.facebookUrl("javascript:x"), "");
});
