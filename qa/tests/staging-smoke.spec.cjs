'use strict';

const { test, expect } = require('@playwright/test');

const stagingUrl = process.env.FORGECUT_STAGING_URL;
test.skip(!stagingUrl, 'Set FORGECUT_STAGING_URL to the staging origin before running cloud QA.');

const routes = [
  {
    name: 'Windows shell',
    path: '/',
    title: /ForgeCut/i,
    required: ['#renderCanvas', '#mediaFileInput', '#audioFileInput', '#imageFileInput']
  },
  {
    name: 'macOS shell',
    path: '/platform/macos/',
    title: /ForgeCut for macOS/i,
    required: ['#fc-editor-shell', '#macToolbar', '#macSidebar', '#macInspector', '#macTimeline']
  }
];

for (const route of routes) {
  test(`${route.name} boots on staging`, async ({ page, baseURL }, testInfo) => {
    const pageErrors = [];
    const sameOriginFailures = [];
    const consoleErrors = [];

    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', request => {
      try {
        const target = new URL(request.url());
        const origin = new URL(baseURL);
        if (target.origin === origin.origin && !['net::ERR_ABORTED'].includes(request.failure()?.errorText)) {
          sameOriginFailures.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' });
        }
      } catch (_) {}
    });

    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    expect(response, 'navigation should return a document response').not.toBeNull();
    expect(response.status(), 'staging route should return a successful response').toBeLessThan(400);
    await expect(page).toHaveTitle(route.title);

    for (const selector of route.required) {
      await expect(page.locator(selector).first(), `required shell element missing: ${selector}`).toBeAttached();
    }

    await page.waitForTimeout(2_000);
    await page.screenshot({
      path: testInfo.outputPath(`${route.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`),
      fullPage: true
    });

    expect(pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(sameOriginFailures, 'failed requests to ForgeCut staging assets').toEqual([]);
    // Console errors are recorded as evidence, not automatically failed: optional
    // third-party fonts and browser capability warnings can be environmental.
    await testInfo.attach('console-errors.json', {
      body: Buffer.from(JSON.stringify(consoleErrors, null, 2)),
      contentType: 'application/json'
    });
  });
}
