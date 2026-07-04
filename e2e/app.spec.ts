// End-to-end smoke test of the production build: app shell, PWA install
// surface, service worker, cross-origin isolation, and offline behavior.
// Model inference is not exercised (models are hundreds of MB).
import { test, expect } from '@playwright/test';

test('app shell renders with model picker', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Pocket Agent/);
  await expect(page.locator('#header h1')).toHaveText('Pocket Agent');
  // 3 bundled models + custom URL option.
  await expect(page.locator('#model-select option')).toHaveCount(4);
  // Chat is locked until a model loads.
  await expect(page.locator('#send-btn')).toBeDisabled();
  await expect(page.locator('#input')).toBeDisabled();
});

test('custom URL field stays hidden until selected', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#custom-url-row')).toBeHidden();
  await page.locator('#model-select').selectOption('custom');
  await expect(page.locator('#custom-url-row')).toBeVisible();
});

test('PWA manifest and icons are wired up', async ({ page, request }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifest = await (await request.get('/' + manifestHref)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  for (const icon of manifest.icons) {
    const res = await request.get('/' + icon.src);
    expect(res.status(), `icon ${icon.src}`).toBe(200);
  }
  // iOS-specific install tags.
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveCount(1);
  await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveCount(1);
});

test('service worker takes control and enables cross-origin isolation', async ({ page }) => {
  await page.goto('/');
  // The SW registers, then the page silently reloads once so the injected
  // COOP/COEP headers apply — after that SharedArrayBuffer must exist.
  await page.waitForFunction(() => window.crossOriginIsolated, undefined, {
    timeout: 15000,
  });
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
});

test('app shell works offline after first visit', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
    timeout: 15000,
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#header h1')).toHaveText('Pocket Agent');
  await expect(page.locator('#model-select option')).toHaveCount(4);
});

test('iOS visitors get add-to-home-screen instructions', async ({ browser }) => {
  const iosContext = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const page = await iosContext.newPage();
  await page.goto('/');
  await expect(page.locator('#install-banner')).toBeVisible();
  // The banner offers a real, tappable button (not just instructions):
  // it opens the share sheet via navigator.share, which on iOS contains
  // the "Add to Home Screen" action.
  const installBtn = page.locator('#install-content button');
  await expect(installBtn).toBeVisible();
  await expect(installBtn).toHaveText('Add to Home Screen');
  await expect(installBtn).toBeEnabled();
  // Without navigator.share (this headless browser), tapping falls back
  // to explicit Safari instructions instead of doing nothing.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { value: undefined });
  });
  await installBtn.click();
  await expect(page.locator('#install-content')).toContainText('square with an ↑ arrow');
  // Dismissal is remembered.
  await page.locator('#install-dismiss').click();
  await expect(page.locator('#install-banner')).toBeHidden();
  await page.reload();
  await expect(page.locator('#install-banner')).toBeHidden();
  await iosContext.close();
});

test('header share button is disabled until a chat exists', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#share-btn')).toBeDisabled();
  await expect(page.locator('#attach-btn')).toBeEnabled();
});
