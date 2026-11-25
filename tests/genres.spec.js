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

test.describe("Genre badges (iPhone WebKit)", () => {
  test("profile preview shows genre badges, not Bass/Banger/Bopper tiers", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await page.locator('[data-act="tab"][data-id="you"]').click();
    await expect(page.getByRole("button", { name: "Edit Profile" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".prof-hero .genre-badge")).toHaveCount(3);
    await expect(page.locator(".prof-hero")).toContainText(/House/i);
    await expect(page.locator(".prof-hero")).toContainText(/Techno/i);
    await expect(page.locator(".prof-hero")).toContainText(/Disco/i);
    await expect(page.locator(".raver-badge")).toHaveCount(0);
    await expect(page.getByText("Banger", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Bopper", { exact: true })).toHaveCount(0);
  });

  test("Edit Profile lets you pick up to 5 genre badges", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await page.locator('[data-act="tab"][data-id="you"]').click();
    await expect(page.getByRole("button", { name: "Edit Profile" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Edit Profile" }).click();
    await expect(page.getByText("Genre badges")).toBeVisible();
    await expect(page.getByText("Pick up to 5")).toBeVisible();
    await expect(page.locator('[data-act="edit-toggle-vibe"]')).toHaveCount(28);
    await expect(page.locator('[data-act="edit-toggle-vibe"].on')).toHaveCount(3);
    await page.locator('[data-act="edit-toggle-vibe"][data-id="riddim"]').click();
    await expect(page.locator('[data-act="edit-toggle-vibe"][data-id="riddim"]')).toHaveClass(/on/);
    await page.locator('[data-act="edit-toggle-vibe"][data-id="dubstep"]').click();
    await expect(page.locator('[data-act="edit-toggle-vibe"][data-id="dubstep"]')).toHaveClass(/on/);
    await expect(page.locator('[data-act="edit-toggle-vibe"].on')).toHaveCount(5);
    await page.locator('[data-act="edit-toggle-vibe"][data-id="trance"]').click();
    await expect(page.locator('[data-act="edit-toggle-vibe"][data-id="trance"]')).not.toHaveClass(/on/);
    await expect(page.locator('[data-act="edit-toggle-vibe"].on')).toHaveCount(5);
  });

  test("tapping a genre badge opens people and events for that sound", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await page.locator('[data-act="tab"][data-id="you"]').click();
    await expect(page.locator(".prof-hero .genre-badge").first()).toBeVisible({ timeout: 20_000 });
    await page.locator(".prof-hero .genre-badge").first().click();
    await expect(page.locator(".sheet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show in Discover" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".sheet")).toContainText(/People into|No one has this badge/i);
    await page.getByRole("button", { name: "Show in Discover" }).click();
    await expect(page.locator(".tab[data-id='discover']")).toHaveClass(/on/);
  });

  test("feed author rows show compact genre badges without nested buttons or tier badges", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await expect(page.locator(".tabbar")).toBeVisible();
    const badgeButtons = page.locator("button .genre-badge[data-act], button button.genre-badge");
    await expect(badgeButtons).toHaveCount(0);
    await expect(page.locator(".raver-badge")).toHaveCount(0);
  });
});
