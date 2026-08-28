import type { Locator, Page } from "@playwright/test";

export const CANONICAL_QUERY =
  "pet friendly 2br under $2400 near Lake Eola with in-unit laundry";

export class SearchPage {
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly cards: Locator;
  readonly relaxationHints: Locator;

  constructor(readonly page: Page) {
    this.searchInput = page.getByLabel("Search Orlando apartments");
    this.searchButton = page.getByRole("button", { name: "Search" });
    this.cards = page.getByTestId("listing-card");
    this.relaxationHints = page.getByTestId("relaxation-hint");
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  async gotoQuery(q: string, opts: { debug?: boolean } = {}): Promise<void> {
    await this.page.goto(
      `/?q=${encodeURIComponent(q)}${opts.debug ? "&debug=1" : ""}`,
    );
  }

  async search(q: string): Promise<void> {
    await this.searchInput.fill(q);
    await this.searchButton.click();
  }

  chip(label: string): Locator {
    return this.page.getByText(label, { exact: true }).first();
  }

  async promisedCount(hint: Locator): Promise<number> {
    return Number((await hint.textContent())?.match(/shows (\d+)/)?.[1]);
  }
}
