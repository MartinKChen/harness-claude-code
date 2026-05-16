import { expect, test } from "@playwright/test";

// Smoke spec — proves that:
//   - the frontend container is reachable at BASE_URL,
//   - the index page parses,
//   - Playwright itself is correctly installed and can launch chromium.
// It deliberately does NOT assert on product copy or routing — those land
// when the first feature task ships its own specs.
test("frontend index page is reachable and renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
