import { test as base } from "@playwright/test";
import { SearchPage } from "./pages/search-page";
import { ListingPage } from "./pages/listing-page";

/** Specs import { test, expect } from "./fixtures" to get page objects. */
export const test = base.extend<{
  searchPage: SearchPage;
  listingPage: ListingPage;
}>({
  searchPage: async ({ page }, use) => {
    await use(new SearchPage(page));
  },
  listingPage: async ({ page }, use) => {
    await use(new ListingPage(page));
  },
});

export { expect } from "@playwright/test";
