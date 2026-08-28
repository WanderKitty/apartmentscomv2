import { expect, test } from "@playwright/test";

test("detail page shows trust signals and links out to the source", async ({
  page,
}) => {
  await page.goto(
    "/?q=" +
      encodeURIComponent(
        "pet friendly 2br under $2400 near Lake Eola with in-unit laundry",
      ),
  );
  await page.locator('a[href^="/listing/"]').first().click();
  await expect(page).toHaveURL(/\/listing\//);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/^Confirmed /).first()).toBeVisible();
  await expect(page.getByText("About this data")).toBeVisible();
  const outbound = page.getByRole("link", { name: /View at property site/ });
  await expect(outbound).toBeVisible();
  await expect(outbound).toHaveAttribute("target", "_blank");

  await page.getByRole("link", { name: "← Back to search" }).click();
  await expect(page.getByLabel("Search Orlando apartments")).toBeVisible();
});

test("price-drop seed exemplar shows history and net-effective math", async ({
  page,
}) => {
  // seed___u0003: "starting at" studio with 2 price drops + 1 month free.
  await page.goto("/listing/seed___u0003");
  await expect(
    page.getByText("“Starting at” price — actual units may cost more."),
  ).toBeVisible();
  await expect(page.getByText(/net effective with\s+concessions/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Price history" }),
  ).toBeVisible();
  await expect(page.getByText(/↓/).first()).toBeVisible();
});

test("unknown listing id 404s honestly", async ({ page }) => {
  const res = await page.goto("/listing/entrata___does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("This listing isn’t here.")).toBeVisible();
});

test("malformed listing id (no separator) 404s", async ({ page }) => {
  const res = await page.goto("/listing/garbage");
  expect(res?.status()).toBe(404);
});
