import type { Locator, Page, Response } from "@playwright/test";

/** The listing detail route: trust signals, money math, outbound links. */
export class ListingPage {
  readonly heading: Locator;
  readonly outboundLink: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("heading", { level: 1 });
    this.outboundLink = page.getByRole("link", { name: /View at property site/ });
  }

  async open(id: string): Promise<Response | null> {
    return this.page.goto(`/listing/${id}`);
  }

  async back(): Promise<void> {
    await this.page.getByRole("link", { name: "← Back to search" }).click();
  }
}
