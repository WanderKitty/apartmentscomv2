import { expect, test } from "../fixtures";

test("home page renders", async ({ page, searchPage }) => {
  await searchPage.goto();
  await expect(
    page.getByRole("heading", {
      name: "Every listing, straight from the property.",
    }),
  ).toBeVisible();
  await expect(searchPage.searchInput).toBeVisible();
});

test("search returns listings", async ({ searchPage }) => {
  await searchPage.gotoQuery("1 bed");
  await expect(searchPage.cards.first()).toBeVisible();
});

test("listing detail opens with an outbound source link", async ({
  page,
  searchPage,
  listingPage,
}) => {
  await searchPage.gotoQuery("1 bed");
  await searchPage.cards.first().click();
  await expect(page).toHaveURL(/\/listing\//);
  await expect(listingPage.heading).toBeVisible();
  await expect(listingPage.outboundLink).toBeVisible();
});

test("health endpoint reports database up", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, db: "up" });
});
