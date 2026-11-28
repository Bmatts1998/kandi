"use strict";

const path = require("path");
const fs = require("fs");
const { test, expect } = require("@playwright/test");

const shotDir = process.env.KANDI_TRADE_SHOTS || path.join(__dirname, "..", "..", "kandi-trades-shots");
fs.mkdirSync(shotDir, { recursive: true });

async function shot(page, name, locator) {
  if (locator) await expect(locator).toBeVisible();
  if (locator) await locator.evaluate((el) => {
    const sc = el.closest(".scroll") || el.closest(".overlay") || el;
    if (sc && sc.scrollTo) {
      const top = el === sc ? 0 : (el.offsetTop - 8);
      sc.scrollTo(0, Math.max(0, top));
    } else if (el.scrollIntoView) el.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: require("path").join(shotDir, name), fullPage: false });
}

async function signup(page, username, name) {
  const res = await page.request.post("/api/signup", { data: { username, email: username + "@example.com", password: "qa-pass-1234", name, age: 25, acceptedTerms: true } });
  expect(res.ok()).toBeTruthy();
  const put = await page.request.put("/api/me", { data: { vibes: ["dubstep"], looking: ["date"], meetIntent: "both", prompts: [{ id: "p1", q: "My go-to set is...", a: "Any night that starts with kandi." }] } });
  expect(put.ok(), await put.text()).toBeTruthy();
  return (await put.json()).user;
}

test.describe("Digital kandi trades (iPhone WebKit)", () => {
  test("trade flow, collection, hide, and iOS has no paywall", async ({ browser, page }) => {
    const tag = String(Date.now() % 100000);
    const ua = await signup(page, "tk_a_" + tag, "Ava Bead");
    await page.goto("/");
    await expect(page.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-act="tab"][data-id="you"]').click();
    await expect(page.locator("#kandi-collection")).toBeVisible();
    await expect(page.locator("#kandi-collection")).toContainText("Kandi collection");
    await expect(page.locator("#kandi-collection")).toContainText("Trade kandi when you meet someone");
    await shot(page, "01-collection-empty.png", page.locator("#kandi-collection"));

    await page.locator('[data-act="trade-open"]').first().click();
    await expect(page.locator(".trade-overlay")).toBeVisible();
    await expect(page.locator(".trade-overlay")).toContainText("Trade digital kandi");
    await shot(page, "02-trade-start.png");

    await page.locator('[data-act="trade-open-host"]').click();
    await expect(page.locator(".trade-code")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#trade-qr")).toBeVisible();
    const code = (await page.locator(".trade-code").innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    await shot(page, "03-host-qr.png");

    const other = await browser.newContext();
    const pb = await other.newPage();
    const ub = await signup(pb, "tk_b_" + tag, "Beau Cuff");
    await pb.goto("/");
    await expect(pb.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    await pb.locator('[data-act="tab"][data-id="you"]').click();
    await pb.locator('[data-act="trade-open"]').first().click();
    await pb.locator('[data-act="trade-open-join"]').click();
    await expect(pb.locator("[data-field='tradeCode']")).toBeVisible();
    await shot(pb, "04-join-scan.png");
    await pb.locator("[data-field='tradeCode']").fill(code);
    await pb.locator('[data-act="trade-submit-code"]').click();
    await expect(pb.locator(".trade-design")).toBeVisible({ timeout: 15_000 });
    await expect(pb.locator(".trade-design")).toContainText("Ava Bead");
    await pb.locator("#kd-word").fill("RAVE");
    await pb.locator("[data-act='kd-style'][data-id='sunset']").click();
    await shot(pb, "05-guest-design.png");
    await pb.locator('[data-act="trade-ready"]').click();
    await expect(pb.locator(".trade-wait")).toBeVisible({ timeout: 15_000 });

    await expect(page.locator(".trade-design")).toBeVisible({ timeout: 20_000 });
    await page.locator("#kd-word").fill("PLUR");
    await shot(page, "06-host-design.png");
    await page.locator('[data-act="trade-ready"]').click();

    await expect(page.locator(".trade-done")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".trade-done")).toContainText("It's a trade!");
    await shot(page, "07-celebrate.png", page.locator(".trade-done"));
    await expect(pb.locator(".trade-done")).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-act="trade-goto-you"]').click();
    await expect(page.locator("#kandi-collection .kandi-col-item")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#kandi-collection")).toContainText("RAVE");
    await shot(page, "08-collection-filled.png", page.locator("#kandi-collection"));

    await page.locator("#kandi-collection .kandi-col-item").first().click();
    await expect(page.locator(".kandi-sheet")).toBeVisible();
    await expect(page.locator(".kandi-sheet")).toContainText("Beau Cuff");
    await expect(page.locator(".kandi-sheet [data-act='report']")).toBeVisible();
    await shot(page, "09-kandi-detail.png", page.locator(".kandi-sheet"));
    await page.locator('[data-act="trade-hide"]').click();
    await expect(page.locator(".kandi-sheet")).toContainText("Show on my profile");

    // iOS client: Trade kandi is free, no Plus / prices
    const ios = await browser.newContext();
    await ios.addInitScript(() => { window.Capacitor = { getPlatform: () => "ios", isNativePlatform: () => true }; });
    const ip = await ios.newPage();
    await signup(ip, "tk_ios_" + tag, "Ivy iOS");
    await ip.goto("/");
    await expect(ip.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    await ip.locator('[data-act="tab"][data-id="you"]').click();
    await expect(ip.locator(".pf-actions [data-act='trade-open'], #kandi-collection [data-act='trade-open']")).toHaveCount(2);
    await expect(ip.locator('[data-act="upgrade"]')).toHaveCount(0);
    await ip.getByRole("button", { name: "Settings", exact: true }).click();
    const body = ip.locator(".overlay");
    await expect(body).toContainText("Trade kandi");
    await expect(body).not.toContainText("Upgrade to Kandi Plus");
    await expect(body).not.toContainText("$");
    await ip.locator('.set-group [data-act="trade-open"]').click();
    await expect(ip.locator(".trade-overlay")).toBeVisible();
    await shot(ip, "10-ios-trade.png");

    await other.close();
    await ios.close();
  });
});
