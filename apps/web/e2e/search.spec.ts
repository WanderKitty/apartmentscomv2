import { expect, test } from "./fixtures";
import { CANONICAL_QUERY } from "./pages/search-page";

test("home page offers search and example queries", async ({ page, searchPage }) => {
  await searchPage.goto();
  await expect(
    page.getByRole("heading", {
      name: "Every listing, straight from the property.",
    }),
  ).toBeVisible();
  await expect(searchPage.searchInput).toBeVisible();
  await expect(
    page.getByRole("link", { name: "2 bed in Baldwin Park with a pool" }),
  ).toBeVisible();
});

test("blank query still shows the hero, not an empty result page", async ({ page }) => {
  await page.goto("/?q=%20");
  await expect(
    page.getByRole("heading", {
      name: "Every listing, straight from the property.",
    }),
  ).toBeVisible();
});

test("canonical demo query returns 2 listings with honest parse chips", async ({
  page,
  searchPage,
}) => {
  await searchPage.goto();
  await searchPage.search(CANONICAL_QUERY);
  await expect(page).toHaveURL(/\?q=/);

  await expect(page.getByText("What we understood")).toBeVisible();
  for (const chip of [
    "Lake Eola Heights",
    "Under $2,400",
    "2 bd",
    "pet friendly",
    "in-unit laundry",
  ]) {
    await expect(searchPage.chip(chip)).toBeVisible();
  }
  await expect(page.getByText("keyword fallback")).toBeVisible();

  await expect(page.getByText(/2 listings · ranked by relevance/)).toBeVisible();
  await expect(searchPage.cards).toHaveCount(2);

  await expect(page.getByText(/Corpus: 26 seeded demo listings/)).toBeVisible();
});

test("every result is a card with price or an honest no-price badge", async ({
  searchPage,
}) => {
  await searchPage.gotoQuery("studio");
  const n = await searchPage.cards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const card = searchPage.cards.nth(i);
    // Facts line (beds/baths) — may be prefixed by the neighborhood on the
    // photo-first card, so the match is unanchored.
    await expect(card.getByText(/Studio · /).first()).toBeVisible();
    const priced = await card.getByText(/^\$[\d,]+/).count();
    const unpriced = await card.getByText("Price not listed").count();
    expect(priced + unpriced).toBeGreaterThan(0);
  }
});

test("zero results offer relaxation hints that keep their promise", async ({
  page,
  searchPage,
}) => {
  await searchPage.gotoQuery("studio in baldwin park with pool under 900");
  await expect(
    page.getByText("No listings match everything you asked for."),
  ).toBeVisible();

  const hint = searchPage.relaxationHints.first();
  await expect(hint).toBeVisible();
  const promised = await searchPage.promisedCount(hint);
  expect(promised).toBeGreaterThan(0);

  await hint.click();
  await expect(searchPage.cards.first()).toBeVisible();
  const shown = await searchPage.cards.count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThanOrEqual(promised);
});

test("debug mode reveals the score blend per card", async ({ page, searchPage }) => {
  await searchPage.gotoQuery("1 bed", { debug: true });
  await expect(page.getByText("Hide score breakdown")).toBeVisible();
  await expect(
    page.getByText(/relevance \d\.\d\d .* → score \d\.\d\d/).first(),
  ).toBeVisible();
});

test("unparseable query fails open into keyword search", async ({
  page,
  searchPage,
}) => {
  await searchPage.gotoQuery("walk in closet");
  await expect(page.getByText(/searching the words themselves/)).toBeVisible();
  await expect(searchPage.cards.first()).toBeVisible();
});
