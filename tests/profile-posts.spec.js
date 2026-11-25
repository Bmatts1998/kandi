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
  await expect(page.getByRole("button", { name: "Edit Profile" })).toBeVisible({ timeout: 20_000 });
}

test.describe("Profile preview, edit, and posts (iPhone WebKit)", () => {
  test("You tab is a read-only preview with Edit Profile, Posts grid/list, and New Post", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await openYou(page);

    const you = page.locator(".screen.has-tabs, .screen").first();
    await expect(page.getByRole("button", { name: "Edit Profile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New Post" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Posts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "About" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Grid view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "List view" })).toBeVisible();

    // Preview must not include inline photo editors.
    await expect(page.locator(".scroll .photo-editor")).toHaveCount(0);
    await expect(page.locator(".scroll .slot-x")).toHaveCount(0);
    await expect(page.locator(".prof-hero .prof-avatar-wrap")).toHaveCount(0);
    await expect(page.locator(".avatar-ring[data-story-ring]")).toBeVisible();

    await page.getByRole("button", { name: "About" }).click();
    await expect(page.locator(".prof-facts")).toBeVisible();
    await expect(page.locator(".prof-chips").first()).toBeVisible();

    await page.getByRole("button", { name: "Posts" }).click();
    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.locator(".post-view-toggle button[data-id='list']")).toHaveClass(/on/);
    await page.getByRole("button", { name: "Grid view" }).click();
    await expect(page.locator(".post-view-toggle button[data-id='grid']")).toHaveClass(/on/);
  });

  test("Edit Profile is a separate full-screen editor with details and My Tunes", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await openYou(page);
    await page.getByRole("button", { name: "Edit Profile" }).click();
    await expect(page.locator(".overlay .header", { hasText: "Edit Profile" })).toBeVisible();
    await expect(page.locator(".photo-editor")).toBeVisible();
    await expect(page.locator(".photo-editor input.file-sr")).toHaveCount(1);
    const fileId = await page.locator(".photo-editor input.file-sr").getAttribute("id");
    expect(fileId).toBeTruthy();
    expect(await page.locator(`.photo-editor label[for="${fileId}"]`).count()).toBeGreaterThan(0);
    await expect(page.locator(".photo-slot.add").first()).toHaveAttribute("for", fileId);
    await expect(page.locator('[data-field="editName"]')).toBeVisible();
    await expect(page.locator('[data-field="editBio"]')).toBeVisible();
    await expect(page.locator('[data-field="editAge"]')).toBeVisible();
    await expect(page.getByText("My Tunes")).toBeVisible();
    await expect(page.locator('[data-field="editTune0"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview", exact: true }).first()).toBeVisible();

    const unique = "Preview bio " + Date.now();
    await page.locator('[data-field="editBio"]').fill(unique);
    await page.getByRole("button", { name: "Preview", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Back to editing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByText("how other people see your profile")).toBeVisible();
    await expect(page.getByText(unique)).toBeVisible();
    // Exactly as others see it: no edit chrome, no Edit Profile / New Post.
    await expect(page.locator(".overlay .photo-editor")).toHaveCount(0);
    await expect(page.locator(".overlay .slot-x")).toHaveCount(0);
    await expect(page.locator(".overlay [data-act='edit-profile']")).toHaveCount(0);
    await expect(page.locator(".overlay [data-act='open-composer']")).toHaveCount(0);

    await page.getByRole("button", { name: "Back to editing" }).click();
    await expect(page.locator(".overlay .header", { hasText: "Edit Profile" })).toBeVisible();
    await expect(page.locator('[data-field="editBio"]')).toHaveValue(unique);
    await expect(page.locator(".photo-editor")).toBeVisible();

    await page.locator('.overlay .header [data-act="close"]').click();
    await expect(page.locator(".overlay .header", { hasText: "Edit Profile" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit Profile" })).toBeVisible();
    // Unsaved preview edits were not saved.
    await expect(page.getByText(unique)).toHaveCount(0);
  });

  test("New Post composer accepts photos, video, caption, and an event tag", async ({ page }) => {
    await login(page, "vesper", "plur-demo");
    await openYou(page);
    await page.getByRole("button", { name: "New Post" }).click();
    await expect(page.locator(".overlay .header", { hasText: "New post" })).toBeVisible();
    await expect(page.locator('[data-field="caption"]')).toBeVisible();
    await expect(page.locator("label[for^='kandi-file-post-photos']")).toBeVisible();
    await expect(page.locator("label[for^='kandi-file-post-video']")).toBeVisible();
    const photoInput = page.locator("input.file-sr[data-act-file='post-photos']");
    const videoInput = page.locator("input.file-sr[data-act-file='post-video']");
    await expect(photoInput).toBeAttached();
    await expect(videoInput).toBeAttached();
    await expect(photoInput).not.toHaveCSS("display", "none");
    await expect(videoInput).not.toHaveCSS("display", "none");
    await expect(page.getByText("Tag a rave or concert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post", exact: true })).toBeVisible();
    await page.locator('.overlay .header [data-act="close"]').click();
    await expect(page.getByRole("button", { name: "New Post" })).toBeVisible();
  });
});
