"use strict";

const path = require("path");
const fs = require("fs");
const { test, expect } = require("@playwright/test");

const shotDir = process.env.KANDI_DESIGN_SHOTS || path.join(__dirname, "..", "..", "kandi-designs-shots");
fs.mkdirSync(shotDir, { recursive: true });

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shotDir, name), fullPage: false });
}

async function signup(page, username, name) {
  const res = await page.request.post("/api/signup", { data: { username, email: username + "@example.com", password: "qa-pass-1234", name, age: 25, acceptedTerms: true } });
  expect(res.ok()).toBeTruthy();
  const put = await page.request.put("/api/me", { data: { vibes: ["dubstep"], looking: ["date"], meetIntent: "both", prompts: [{ id: "p1", q: "My go-to set is...", a: "Any night that starts with kandi." }] } });
  expect(put.ok(), await put.text()).toBeTruthy();
}

async function scrollTo(page, selector) {
  await page.locator(selector).first().evaluate((el) => {
    const sc = el.closest(".scroll") || el.closest(".overlay");
    if (sc) sc.scrollTo(0, Math.max(0, el.offsetTop - 8));
  });
}

test.describe("Kandi designer + My designs (iPhone WebKit)", () => {
  test("build, save, edit, duplicate, delete, and trade with a saved design", async ({ browser, page }) => {
    const tag = String(Date.now() % 100000);
    await signup(page, "kd_a_" + tag, "Ava Bead");
    await page.goto("/");
    await expect(page.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-act="tab"][data-id="you"]').click();
    await expect(page.locator("#kandi-collection")).toBeVisible();
    await expect(page.locator("#kandi-collection [data-act='kd-open']")).toBeVisible();
    await scrollTo(page, "#kandi-collection");
    await shot(page, "01-collection-my-designs-button.png");

    // My designs (empty) -> New design
    await page.locator("#kandi-collection [data-act='kd-open']").click();
    await expect(page.locator(".trade-overlay")).toContainText("My designs");
    await expect(page.locator(".kd-empty")).toBeVisible();
    await shot(page, "02-my-designs-empty.png");
    await page.locator("[data-act='kd-new']").click();
    await expect(page.locator(".kd-editor")).toBeVisible();
    await shot(page, "03-designer-top.png");

    // Neon quick start, hearts + stars, charm, word, custom painting
    await page.locator("[data-act='kd-style'][data-id='neon']").click();
    await page.locator("[data-act='kd-pattern'][data-id='alternating']").click();
    await page.locator("[data-act='kd-palette'][data-id='neon']").click();
    await page.locator("[data-act='kd-color'][data-id='#ff0080']").click();
    await page.locator("[data-act='kd-slot'][data-id='B']").click();
    await page.locator("[data-act='kd-color'][data-id='#00f0ff']").click();
    await page.locator("[data-act='kd-shape'][data-id='heart']").click();
    await page.locator("[data-act='kd-len'][data-id='=16']").click();
    await expect(page.locator("#kd-live .kandi-bracelet")).toBeVisible();
    await page.locator("#kd-live [data-act='kd-bead'][data-id='3']").click(); // paints bead 3 -> switches to custom
    await page.locator("[data-act='kd-shape'][data-id='star']").click();
    await page.locator("#kd-live [data-act='kd-bead'][data-id='4']").click();
    await page.locator("[data-act='kd-shape'][data-id='pony']").click();
    await page.locator("#kd-live [data-act='kd-bead'][data-id='13']").click();
    await page.locator("[data-act='kd-charm'][data-id='bolt']").click();
    await page.locator("#kd-word").fill("plur");
    await page.locator("#kd-name").fill("Festival kandi");
    await expect(page.locator("#kd-live .shape-heart").first()).toBeVisible();
    await expect(page.locator("#kd-live .shape-star").first()).toBeVisible();
    await expect(page.locator("#kd-live .shape-pony").first()).toBeVisible();
    await expect(page.locator("#kd-live .kandi-charm")).toBeVisible();
    await expect(page.locator("#kd-live .kandi-bead.letter")).toHaveCount(4);
    await shot(page, "04-designer-built.png");
    await scrollTo(page, "#kd-ctl1");
    await shot(page, "05-designer-colors-shapes.png");
    await scrollTo(page, "#kd-ctl2");
    await shot(page, "06-designer-charm-word.png");

    await page.locator("[data-act='kd-save']").click();
    await expect(page.locator(".kd-card")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(".kd-card")).toContainText("Festival kandi");
    await shot(page, "07-my-designs-one.png");

    // Duplicate, edit the copy, delete with confirm
    await page.locator("[data-act='kd-dup']").first().click();
    await expect(page.locator(".kd-card")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator(".kd-cards")).toContainText("Festival kandi copy");
    await page.locator(".kd-card", { hasText: "copy" }).locator("[data-act='kd-edit']").last().click();
    await page.locator("#kd-name").fill("Rainbow cuff");
    await page.locator("[data-act='kd-pattern'][data-id='rainbow']").click();
    await page.locator("[data-act='kd-len'][data-id='=24']").click();
    await page.locator("[data-act='kd-charm'][data-id='rainbow']").click();
    await shot(page, "08-edit-rainbow-cuff.png");
    await page.locator("[data-act='kd-save']").click();
    await expect(page.locator(".kd-cards")).toContainText("Rainbow cuff", { timeout: 15_000 });
    await shot(page, "09-my-designs-two.png");
    await page.locator(".kd-card", { hasText: "Rainbow cuff" }).locator("[data-act='kd-del-ask']").click();
    await page.locator(".kd-card", { hasText: "Rainbow cuff" }).locator("[data-act='kd-delete']").click();
    await expect(page.locator(".kd-card")).toHaveCount(1, { timeout: 15_000 });
    // add a pastel/glitter one so the strip has variety
    await page.locator("[data-act='kd-new']").click();
    await page.locator("[data-act='kd-style'][data-id='pastel']").click();
    await page.locator("[data-act='kd-charm'][data-id='butterfly']").click();
    await page.locator("#kd-name").fill("Pastel dream");
    await page.locator("[data-act='kd-save']").click();
    await expect(page.locator(".kd-card")).toHaveCount(2, { timeout: 15_000 });
    await page.locator("[data-act='trade-close']").click();
    await expect(page.locator(".trade-overlay")).toHaveCount(0);

    // Trade screen reaches My designs too
    await page.locator("#kandi-collection [data-act='trade-open']").click();
    await expect(page.locator(".trade-overlay [data-act='kd-open']")).toBeVisible();
    await shot(page, "10-trade-start-my-designs.png");
    await page.locator(".trade-overlay [data-act='kd-open']").click();
    await expect(page.locator(".kd-cards")).toBeVisible();
    await page.locator("[data-act='trade-close']").click();
    await expect(page.locator(".trade-overlay")).toContainText("Trade digital kandi");
    await page.locator('[data-act="trade-open-host"]').click();
    await expect(page.locator(".trade-code")).toBeVisible({ timeout: 15_000 });
    const code = (await page.locator(".trade-code").innerText()).trim();

    // Second person joins; designs on the spot and saves it
    const other = await browser.newContext();
    const pb = await other.newPage();
    await signup(pb, "kd_b_" + tag, "Beau Cuff");
    await pb.goto("/");
    await expect(pb.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    await pb.locator('[data-act="tab"][data-id="you"]').click();
    await pb.locator('[data-act="trade-open"]').first().click();
    await pb.locator('[data-act="trade-open-join"]').click();
    await pb.locator("[data-field='tradeCode']").fill(code);
    await pb.locator('[data-act="trade-submit-code"]').click();
    await expect(pb.locator(".trade-design")).toBeVisible({ timeout: 15_000 });
    await expect(pb.locator(".kd-strip")).toHaveCount(0); // no saved designs yet
    await pb.locator("#kd-word").fill("RAVE");
    await pb.locator("[data-act='kd-style'][data-id='glitter']").click();
    await pb.locator("[data-act='kd-shape'][data-id='star']").click();
    await pb.locator("[data-act='kd-charm'][data-id='crown']").click();
    await pb.locator("[data-act='kd-save-toggle']").click();
    await expect(pb.locator("#kd-name")).toBeVisible();
    await pb.locator("#kd-name").fill("Beau's glitter");
    await shot(pb, "11-trade-new-design-save.png");
    await pb.locator('[data-act="trade-ready"]').click();
    await expect(pb.locator(".trade-wait")).toBeVisible({ timeout: 15_000 });

    // Host picks a saved design (default to last used: none yet, so pick one)
    await expect(page.locator(".trade-design")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".kd-strip .kd-pick")).toHaveCount(3);
    await page.locator(".kd-pick", { hasText: "Festival kandi" }).click();
    await expect(page.locator("#kd-word")).toHaveValue("PLUR");
    await expect(page.locator(".kd-savebox")).toContainText("Trading sends a copy");
    await page.locator("[data-act='kd-shape'][data-id='cube']").click(); // tweak on the spot, saved design unchanged
    await page.locator("#kd-live [data-act='kd-bead'][data-id='0']").click();
    await expect(page.locator(".kd-savebox")).toContainText("Save as a new design");
    await shot(page, "12-trade-pick-saved.png");
    await page.locator('[data-act="trade-ready"]').click();
    await expect(page.locator(".trade-done")).toBeVisible({ timeout: 15_000 });
    await shot(page, "13-trade-done.png");
    await expect(pb.locator(".trade-done")).toBeVisible({ timeout: 15_000 });
    await shot(pb, "14-trade-done-guest.png");

    // Collection shows shapes + charm; Beau's saved design now exists
    await page.locator('[data-act="trade-goto-you"]').click();
    await expect(page.locator("#kandi-collection .kandi-col-item")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#kandi-collection .kandi-charm")).toBeVisible();
    await scrollTo(page, "#kandi-collection");
    await shot(page, "15-collection-with-charm.png");

    // Beau's next trade defaults to last used (the saved glitter design)
    const res = await pb.request.get("/api/kandi-designs");
    const data = await res.json();
    expect(data.designs.map((d) => d.name)).toContain("Beau's glitter");
    expect(data.lastUsedId).toBe(data.designs[0].id);

    // The saved design Ava traded with was not changed by the on-the-spot tweak
    const mine = await (await page.request.get("/api/kandi-designs")).json();
    const fest = mine.designs.find((d) => d.name === "Festival kandi");
    expect(fest.design.shapes).not.toContain("cube");
    expect(mine.lastUsedId).toBe("");

    // iOS client: no prices/Plus in My designs
    const ios = await browser.newContext();
    await ios.addInitScript(() => { window.Capacitor = { getPlatform: () => "ios", isNativePlatform: () => true }; });
    const ip = await ios.newPage();
    await signup(ip, "kd_ios_" + tag, "Ivy iOS");
    await ip.goto("/");
    await expect(ip.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    await ip.locator('[data-act="tab"][data-id="you"]').click();
    await ip.locator("#kandi-collection [data-act='kd-open']").click();
    await expect(ip.locator(".trade-overlay")).toContainText("My designs");
    await expect(ip.locator(".trade-overlay")).not.toContainText("$");
    await expect(ip.locator(".trade-overlay")).not.toContainText("Plus");
    await shot(ip, "16-ios-my-designs.png");
    await other.close();
    await ios.close();
  });
});
