import { expect, test } from "@playwright/test";

const CANONICAL =
  "pet friendly 2br under $2400 near Lake Eola with in-unit laundry";

test("home page offers search and example queries", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Every listing, straight from the property.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Search Orlando apartments")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "2 bed in Baldwin Park with a pool" }),
  ).toBeVisible();
});

test("canonical demo query returns 2 listings with honest parse chips", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Search Orlando apartments").fill(CANONICAL);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\?q=/);

  // The parse echo shows every hard filter the query became.
  await expect(page.getByText("What we understood")).toBeVisible();
  for (const chip of [
    "Lake Eola Heights",
    "Under $2,400",
    "2 bd",
    "pet friendly",
    "in-unit laundry",
  ]) {
    await expect(page.getByText(chip, { exact: true }).first()).toBeVisible();
  }
  // No API key in e2e → the fail-open keyword rung, surfaced honestly.
  await expect(page.getByText("keyword fallback")).toBeVisible();

  await expect(page.getByText(/2 listings · ranked by relevance/)).toBeVisible();
  await expect(page.locator('a[href^="/listing/"]')).toHaveCount(2);

  // Seed provenance is disclosed.
  await expect(page.getByText(/Corpus: 26 seeded demo listings/)).toBeVisible();
});

test("every result is a card with price or an honest no-price badge", async ({
  page,
}) => {
  await page.goto("/?q=studio");
  const cards = page.locator('a[href^="/listing/"]');
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    await expect(card.getByText(/^Studio · /).first()).toBeVisible();
    const priced = await card.locator("span", { hasText: /^\$[\d,]+$/ }).count();
    const unpriced = await card.getByText("Price not listed").count();
    expect(priced + unpriced).toBeGreaterThan(0);
  }
});

test("zero results offer relaxation hints that keep their promise", async ({
  page,
}) => {
  await page.goto(
    "/?q=" + encodeURIComponent("studio in baldwin park with pool under 900"),
  );
  await expect(
    page.getByText("No listings match everything you asked for."),
  ).toBeVisible();

  const hint = page.locator('a[href^="/?q="]', { hasText: /^removing / }).first();
  await expect(hint).toBeVisible();
  const promised = Number((await hint.textContent())?.match(/shows (\d+)/)?.[1]);
  expect(promised).toBeGreaterThan(0);

  await hint.click();
  const cards = page.locator('a[href^="/listing/"]');
  await expect(cards.first()).toBeVisible();
  const shown = await cards.count();
  // Cards may merge cross-platform duplicates, but a hint must never
  // overpromise what the click delivers.
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThanOrEqual(promised);
});

test("debug mode reveals the score blend per card", async ({ page }) => {
  await page.goto("/?q=1+bed&debug=1");
  await expect(page.getByText("Hide score breakdown")).toBeVisible();
  await expect(
    page.getByText(/relevance \d\.\d\d .* → score \d\.\d\d/).first(),
  ).toBeVisible();
});

test("unparseable query fails open into keyword search", async ({ page }) => {
  await page.goto("/?q=" + encodeURIComponent("walk in closet"));
  await expect(
    page.getByText(/searching the words themselves/),
  ).toBeVisible();
  await expect(page.locator('a[href^="/listing/"]').first()).toBeVisible();
});
