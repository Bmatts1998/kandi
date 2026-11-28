"use strict";

const { test, expect } = require("@playwright/test");

async function login(page, username, password) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await page.locator('[data-field="user"]').fill(username);
  await page.locator('[data-field="pass"]').fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
}

async function openYou(page) {
  await page.locator('[data-act="tab"][data-id="you"]').click();
  await expect(page.locator(".pf-page")).toBeVisible({ timeout: 20_000 });
}

test.describe("Profile photo viewer (iPhone WebKit)", () => {
  test("tapping the cover opens a full-screen uncropped viewer you can close", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await openYou(page);

    const cover = page.locator(".pf-cover[data-act='photo-view']");
    await expect(cover).toBeVisible();
    await cover.click();
    const viewer = page.locator("[data-photo-viewer]");
    await expect(viewer).toBeVisible();
    const media = viewer.locator(".mv-media");
    await expect(media).toBeVisible();
    await expect(media).toHaveCSS("object-fit", "contain");
    await expect(viewer.locator(".mv-counter")).toContainText("/");
    await expect(viewer.getByRole("button", { name: "Close" })).toBeVisible();

    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(viewer).toHaveCount(0);

    // Strip photo also opens it; Escape closes.
    const strip = page.locator(".photo-strip [data-act='photo-view']").first();
    await expect(strip).toBeVisible();
    await strip.click();
    await expect(page.locator("[data-photo-viewer]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-photo-viewer]")).toHaveCount(0);
  });

  test("Discover card photos open the same viewer", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await page.locator('[data-act="tab"][data-id="discover"]').click();
    const photo = page.locator(".photo[data-act='photo-view']").first();
    await expect(photo).toBeVisible({ timeout: 20_000 });
    await photo.click();
    await expect(page.locator("[data-photo-viewer]")).toBeVisible();
    await expect(page.locator("[data-photo-viewer] img.mv-media, [data-photo-viewer] .mv-emoji")).toBeVisible();
    await page.locator("[data-act='photo-view-close']").click();
    await expect(page.locator("[data-photo-viewer]")).toHaveCount(0);
  });
});
