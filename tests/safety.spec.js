"use strict";

const path = require("path");
const fs = require("fs");
const { test, expect } = require("@playwright/test");

const shotDir = process.env.KANDI_SAFETY_SHOTS || "/workspace/kandi-safety-shots";
fs.mkdirSync(shotDir, { recursive: true });

async function signup(page, username, name) {
  const res = await page.request.post("/api/signup", {
    data: { username, email: username + "@example.com", password: "qa-pass-1234", name, age: 25, acceptedTerms: true, meetIntent: "both" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const put = await page.request.put("/api/me", { data: { vibes: ["dubstep"], looking: ["friends"], meetIntent: "both", prompts: [{ id: "p1", q: "My go-to set is...", a: "Midnight at the rail." }] } });
  expect(put.ok(), await put.text()).toBeTruthy();
  return (await put.json()).user;
}

async function shot(page, name) {
  const file = path.join(shotDir, name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe("Safety buddy check-in (iPhone WebKit)", () => {
  test("owner can start a check, check in, and a buddy sees the alert", async ({ browser }) => {
    const a = await browser.newContext();
    const b = await browser.newContext();
    const pa = await a.newPage();
    const pb = await b.newPage();
    const suffix = String(Date.now() % 100000);
    const ua = await signup(pa, "sf_a_" + suffix, "Nova");
    const ub = await signup(pb, "sf_b_" + suffix, "Hex");
    await pa.request.post("/api/like", { data: { userId: ub.id, type: "photo", targetId: "0" } });
    const match = await pb.request.post("/api/like", { data: { userId: ua.id, type: "photo", targetId: "0" } });
    expect((await match.json()).matched).toBeTruthy();

    await pa.goto("/");
    await expect(pa.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    await pa.locator('[data-act="tab"][data-id="events"]').click();
    await expect(pa.getByRole("button", { name: "Start a safety check" })).toBeVisible();
    await shot(pa, "01-events-safety-card");
    await pa.getByRole("button", { name: "Start a safety check" }).click();
    await expect(pa.locator(".overlay")).toContainText("Safety check is not an emergency service");
    await expect(pa.locator('a[href="tel:911"]')).toBeVisible();
    await expect(pa.getByText("Hex")).toBeVisible();
    await pa.locator('[data-act="safety-toggle-buddy"]').first().click();
    await expect(pa.locator('[data-act="safety-toggle-buddy"]').first()).toHaveClass(/\bon\b/);
    await pa.locator('[data-field="safetyNote"]').fill("rail, left side");
    await shot(pa, "02-safety-setup");
    await pa.locator('[data-act="safety-start"]').click();
    const active = pa.locator(".overlay").filter({ hasText: "Safety check" });
    await expect(active.locator('[data-act="safety-checkin"]')).toBeVisible({ timeout: 20_000 });
    await expect(active.getByRole("button", { name: "I need help" })).toBeVisible();
    await expect(active).toContainText("call 911");
    await shot(pa, "03-safety-active");

    await pa.locator('.overlay [data-act="close"]').click();
    await expect(pa.locator(".safety-dock")).toBeVisible();
    await expect(pa.locator('.safety-dock [data-act="safety-checkin"]')).toBeVisible();
    await shot(pa, "04-safety-dock");

    await pb.goto("/");
    await expect(pb.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    await pb.locator('[data-act="open-notifs"]').click();
    await expect(pb.locator(".overlay")).toContainText("safety check");
    await shot(pb, "05-buddy-notification");

    await pa.locator('.safety-dock [data-act="open-safety"], [data-act="open-safety"]').first().click();
    await expect(pa.locator('[data-act="safety-help-confirm"]')).toBeVisible();
    await pa.locator('[data-act="safety-help-confirm"]').click();
    await expect(pa.getByRole("button", { name: "Send I need help" })).toBeVisible();
    await expect(pa.locator(".sheet")).toContainText("call 911");
    await shot(pa, "06-help-confirm");
    await pa.locator('[data-act="safety-help"]').click();
    await expect(pa.locator(".overlay")).toContainText("Safety check");
    await shot(pa, "07-after-help");

    await pb.locator('[data-act="close"]').click().catch(() => {});
    // The live alert sheet may already be open from the websocket.
    const incoming = pb.locator(".overlay").filter({ hasText: "need help" }).or(pb.getByText(/need help/i));
    await expect(pb.locator("body")).toContainText(/need help/i, { timeout: 20_000 });
    await shot(pb, "08-buddy-help-alert");

    await a.close();
    await b.close();
  });
});
