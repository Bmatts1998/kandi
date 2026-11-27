"use strict";

const { defineConfig, devices } = require("@playwright/test");

const PORT = Number(process.env.KANDI_TEST_PORT || 8799);
const baseURL = process.env.KANDI_TEST_URL || `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    ...devices["iPhone 13"],
    browserName: "webkit",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: process.env.KANDI_TEST_URL
    ? undefined
    : {
        command: `PORT=${PORT} DATABASE_URL= SEED_ON_BOOT=1 EMAIL_VERIFICATION=off node src/server.js`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
