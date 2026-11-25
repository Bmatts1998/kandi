"use strict";

const { test, expect } = require("@playwright/test");
const sharp = require("sharp");

async function login(page, username, password) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await page.locator('[data-field="user"]').fill(username);
  await page.locator('[data-field="pass"]').fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
}

function minimalMp4() {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
    0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74,
  ]);
}

async function jpegFixture(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 92, b: 0 } },
  }).jpeg({ quality: 92 }).toBuffer();
}

test.describe("Photo variants, cache, and thumbs (iPhone WebKit)", () => {
  test("uploads a large photo, serves thumb and medium with cache headers, and leaves video untouched", async ({ page }) => {
    await login(page, "vesper", "plur-demo");

    const big = await jpegFixture(2000, 1400);
    const upload = await page.request.post("/api/me/photo", {
      multipart: {
        photo: { name: "stage.jpg", mimeType: "image/jpeg", buffer: big },
        caption: "photo-perf",
        main: "1",
      },
    });
    expect(upload.ok(), await upload.text()).toBeTruthy();
    const body = await upload.json();
    const photos = (body.user && body.user.photos) || [];
    const file = [...photos].reverse().find((ph) => ph && ph.type === "file" && /\.(webp|jpe?g)$/i.test(String(ph.url || "")));
    expect(file, "uploaded photo should appear on the profile").toBeTruthy();
    const id = String(file.url).replace(/^\/uploads\//, "").split("?")[0];

    const medium = await page.request.get("/uploads/" + id);
    expect(medium.ok(), "medium " + medium.status() + " " + JSON.stringify(medium.headers()) + " id=" + id).toBeTruthy();
    const mediumBuf = Buffer.from(await medium.body());
    const mediumType = medium.headers()["content-type"];
    expect(mediumType).toMatch(/^image\/(webp|jpeg)/);
    expect(medium.headers()["cache-control"] || "", "headers " + JSON.stringify(medium.headers()) + " url=" + medium.url()).toMatch(/max-age=31536000/);
    expect(medium.headers()["cache-control"]).toMatch(/immutable/);
    const etag = medium.headers()["etag"];
    expect(etag).toBeTruthy();
    const mediumMeta = await sharp(mediumBuf).metadata();
    expect(Math.max(mediumMeta.width, mediumMeta.height)).toBeLessThanOrEqual(1080);

    const thumb = await page.request.get("/uploads/" + id + "?s=thumb");
    expect(thumb.ok()).toBeTruthy();
    const thumbBuf = Buffer.from(await thumb.body());
    expect(thumb.headers()["content-type"]).toMatch(/^image\/(webp|jpeg)/);
    expect(thumb.headers()["cache-control"]).toMatch(/immutable/);
    const thumbMeta = await sharp(thumbBuf).metadata();
    expect(Math.max(thumbMeta.width, thumbMeta.height)).toBeLessThanOrEqual(320);
    expect(thumbBuf.length).toBeLessThan(mediumBuf.length);
    expect(mediumBuf.length).toBeLessThan(big.length);

    const again = await page.request.get("/uploads/" + id, { headers: { "If-None-Match": etag } });
    expect(again.status()).toBe(304);

    const byWidth = await page.request.get("/uploads/" + id + "?w=320");
    expect(byWidth.ok()).toBeTruthy();
    const byWidthBuf = Buffer.from(await byWidth.body());
    expect(byWidthBuf.length).toBe(thumbBuf.length);

    const posted = await page.request.post("/api/posts", {
      multipart: {
        caption: "photo-perf clip",
        video: { name: "clip.mp4", mimeType: "video/mp4", buffer: minimalMp4() },
      },
    });
    expect(posted.ok(), await posted.text()).toBeTruthy();
    const post = (await posted.json()).post;
    expect(post && post.videoUrl).toBeTruthy();
    const videoId = String(post.videoUrl).replace(/^\/uploads\//, "").split("?")[0];
    const video = await page.request.get("/uploads/" + videoId);
    expect(video.ok()).toBeTruthy();
    expect(video.headers()["content-type"]).toMatch(/^video\//);
    const videoBuf = Buffer.from(await video.body());
    expect(videoBuf.equals(minimalMp4())).toBeTruthy();

    await page.reload();
    await expect(page.locator(".tabbar")).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-act="tab"][data-id="you"]').click();
    await expect(page.getByRole("button", { name: "Edit Profile" })).toBeVisible({ timeout: 20_000 });
    const html = await page.content();
    expect(html).toMatch(/\/uploads\/[^"' ]+\?w=320/);
  });
});
