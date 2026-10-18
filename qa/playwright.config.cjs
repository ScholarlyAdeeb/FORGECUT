'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'qa-results/html', open: 'never' }],
    ['json', { outputFile: 'qa-results/results.json' }]
  ],
  outputDir: 'qa-results/test-artifacts',
  use: {
    baseURL: process.env.FORGECUT_STAGING_URL,
    browserName: 'chromium',
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: false
  }
});
