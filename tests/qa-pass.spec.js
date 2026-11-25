"use strict";

// Regression checks from the Nov 2026 user-scenario QA pass.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { test, expect } = require("@playwright/test");

async function signup(page, username, name) {
  const res = await page.request.post("/api/signup", { data: { username, password: "qa-pass-1234", name, age: 25, acceptedTerms: true } });
  expect(res.ok()).toBeTruthy();
  const put = await page.request.put("/api/me", { data: { vibes: ["dubstep"], looking: ["dates"], prompts: [{ id: "p1", q: "My go-to set is...", a: "x".repeat(500) }] } });
  expect(put.ok()).toBeTruthy();
  return (await put.json()).user;
}

test.describe("QA pass regressions (iPhone WebKit)", () => {
  test("profile text is length-limited and long words wrap", async ({ page }) => {
    const me = await signup(page, "qa_wrap_" + Date.now() % 100000, "Wrap Tester");
    expect(me.prompts[0].a.length).toBe(300);
    await page.goto("/");
    await expect(page.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  });

  test("chat photo bubbles are not squashed and the report reason sticks", async ({ browser }) => {
    const a = await browser.newContext(); const b = await browser.newContext();
    const pa = await a.newPage(); const pb = await b.newPage();
    const ua = await signup(pa, "qa_ca_" + Date.now() % 100000, "Chat A");
    const ub = await signup(pb, "qa_cb_" + Date.now() % 100000, "Chat B");
    await pa.request.post("/api/like", { data: { userId: ub.id, type: "photo", targetId: "0" } });
    const m = await pb.request.post("/api/like", { data: { userId: ua.id, type: "photo", targetId: "0" } });
    expect((await m.json()).matched).toBeTruthy();
    const img = path.join(os.tmpdir(), "kandi-qa-chat.png");
    await require("sharp")({ create: { width: 800, height: 1000, channels: 3, background: "#22aa55" } }).png().toFile(img);
    const up = await pb.request.post("/api/chats/" + ua.id, { multipart: { type: "photo", media: { name: "p.png", mimeType: "image/png", buffer: fs.readFileSync(img) } } });
    expect(up.ok()).toBeTruthy();
    for (let i = 0; i < 6; i++) await pb.request.post("/api/chats/" + ua.id, { data: { text: "message " + i + " " + "w".repeat(200) } });

    await pa.goto("/");
    await pa.locator('[data-act="tab"][data-id="matches"]').click();
    await pa.locator('[data-act="chat"]').first().click();
    const bubble = pa.locator(".bubble.photo").first();
    await expect(bubble).toBeVisible();
    await expect.poll(() => pa.evaluate(() => { const el = document.querySelector(".bubble.photo"); return el ? el.getBoundingClientRect().height : 0; })).toBeGreaterThan(150);
    expect(await pa.evaluate(() => { const b = document.querySelector(".bubble.photo").getBoundingClientRect().height; const i = document.querySelector(".bubble.photo .chat-media-btn").getBoundingClientRect().height; return b - i; })).toBeLessThan(40);
    expect(await pa.evaluate(() => document.querySelector(".chat-log").scrollWidth <= document.querySelector(".chat-log").clientWidth + 1)).toBeTruthy();

    await pa.locator('[data-act="chat-menu"]').click();
    await pa.locator('.sheet [data-act="report"]').click();
    const chip = pa.locator('[data-act="report-reason"]', { hasText: "Harassment" });
    await chip.click();
    await expect(chip).toHaveClass(/\bon\b/);
    await a.close(); await b.close();
  });

  test("inside the iOS app: no Safari tip, demo password, fake meetup share, or coming-soon rows", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { window.Capacitor = { getPlatform: () => "ios", isNativePlatform: () => true }; });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("plur-demo");
    await expect(page.locator("body")).not.toContainText("installable web app");
    await expect(page.locator(".ios-tip")).toHaveCount(0);
    await signup(page, "qa_ios_" + Date.now() % 100000, "iOS Tester");
    await page.goto("/");
    await page.locator('[data-act="tab"][data-id="you"]').click();
    await page.getByRole("button", { name: "Settings" }).click();
    const body = page.locator(".overlay");
    await expect(body).toContainText("Delete account");
    await expect(body).not.toContainText("meetup note");
    await expect(body).not.toContainText("coming soon");
    await expect(body).not.toContainText("Coming with the next");
    await expect(page.locator(".ios-tip")).toHaveCount(0);
    await ctx.close();
  });

  test("fills the whole screen on a 430pt-wide iPhone and in landscape", async ({ browser }) => {
    for (const viewport of [{ width: 430, height: 932 }, { width: 844, height: 390 }]) {
      const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
      const box = await page.locator("#app").boundingBox();
      expect(Math.round(box.width)).toBe(viewport.width);
      expect(Math.round(box.height)).toBe(viewport.height);
      await ctx.close();
    }
  });
});
