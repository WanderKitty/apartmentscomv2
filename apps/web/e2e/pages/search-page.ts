import type { Locator, Page } from "@playwright/test";

export const CANONICAL_QUERY =
  "pet friendly 2br under $2400 near Lake Eola with in-unit laundry";

/** The home / results route: search entry, parse echo, result cards, hints. */
export class SearchPage {
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  /** One per rendered result card (the card's link element). */
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

  /** Navigate straight to a results URL, as a shared link would. */
  async gotoQuery(q: string, opts: { debug?: boolean } = {}): Promise<void> {
    await this.page.goto(
      `/?q=${encodeURIComponent(q)}${opts.debug ? "&debug=1" : ""}`,
    );
  }

  /** Search the way a visitor does: type and submit. */
  async search(q: string): Promise<void> {
    await this.searchInput.fill(q);
    await this.searchButton.click();
  }

  /** A parse-echo chip by its exact label. */
  chip(label: string): Locator {
    return this.page.getByText(label, { exact: true }).first();
  }

  /** The listing count a relaxation hint advertises ("… shows N listings"). */
  async promisedCount(hint: Locator): Promise<number> {
    return Number((await hint.textContent())?.match(/shows (\d+)/)?.[1]);
  }
}
