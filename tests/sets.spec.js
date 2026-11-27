"use strict";

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const SHOTS = path.join(__dirname, "sets-shots");
fs.mkdirSync(SHOTS, { recursive: true });

async function login(page, username, password) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await page.locator('[data-field="user"]').fill(username);
  await page.locator('[data-field="pass"]').fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
}

test.describe("Set-time matching (iPhone WebKit)", () => {
  test("show page lists the lineup, catchers, and a same-sets Discover filter", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await page.locator('.tab[data-id="events"]').click();
    const show = page.locator("button.event-main").filter({ hasText: "The Complex" });
    await expect(show).toBeVisible({ timeout: 20_000 });
    await show.click();
    await expect(page.locator(".overlay .lineup-artist").filter({ hasText: "Yheti" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/catching/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Catching the same sets" })).toBeVisible();
    await page.locator(".overlay .lineup-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "show-lineup.png") });

    await page.getByRole("button", { name: "Catching the same sets" }).click();
    await expect(page.locator(".tab[data-id='discover']")).toHaveClass(/on/);
    await expect(page.locator(".meet-chip").filter({ hasText: /You both are catching/ }).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(SHOTS, "discover-same-sets.png"), fullPage: true });
  });

  test("filters include Catching the same sets for everyone, including this iPhone view", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await page.locator('.tab[data-id="discover"]').click();
    await expect(page.locator(".tabbar")).toBeVisible();
    await page.locator('[data-act="filters"]').click();
    const sameSets = page.locator('[data-act="set-sets-filter"][data-id="same"]');
    await expect(sameSets).toBeVisible();
    await expect(page.getByText(/Free for everyone/i)).toBeVisible();
    await sameSets.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "filters-same-sets.png") });
    await sameSets.click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".meet-chip").filter({ hasText: /You both are catching/ }).first()).toBeVisible({ timeout: 20_000 });
  });
});
