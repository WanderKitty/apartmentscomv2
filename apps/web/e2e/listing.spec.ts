import { expect, test } from "./fixtures";
import { CANONICAL_QUERY } from "./pages/search-page";

test("detail page shows trust signals and links out to the source", async ({
  page,
  searchPage,
  listingPage,
}) => {
  await searchPage.gotoQuery(CANONICAL_QUERY);
  await searchPage.cards.first().click();
  await expect(page).toHaveURL(/\/listing\//);

  await expect(listingPage.heading).toBeVisible();
  await expect(page.getByText(/^Confirmed /).first()).toBeVisible();
  await expect(page.getByText("About this data")).toBeVisible();
  await expect(listingPage.outboundLink).toBeVisible();
  await expect(listingPage.outboundLink).toHaveAttribute("target", "_blank");

  await listingPage.back();
  await expect(searchPage.searchInput).toBeVisible();
});

test("price-drop seed exemplar shows history and net-effective math", async ({
  page,
  listingPage,
}) => {
  await listingPage.open("seed___u0003");
  await expect(
    page.getByText("“Starting at” price — actual units may cost more."),
  ).toBeVisible();
  await expect(page.getByText(/net effective with\s+concessions/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Price history" }),
  ).toBeVisible();
  await expect(page.getByText(/↓/).first()).toBeVisible();
});

test("unknown listing id 404s honestly", async ({ page, listingPage }) => {
  const res = await listingPage.open("entrata___does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("This listing isn’t here.")).toBeVisible();
});

test("malformed listing id (no separator) 404s", async ({ listingPage }) => {
  const res = await listingPage.open("garbage");
  expect(res?.status()).toBe(404);
});
