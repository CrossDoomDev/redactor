const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 20_000,
  use: {
    baseURL: "http://127.0.0.1:8765",
    browserName: "chromium",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}
  },
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  webServer: {
    command: "python3 -m http.server 8765 --bind 127.0.0.1",
    url: "http://127.0.0.1:8765",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
