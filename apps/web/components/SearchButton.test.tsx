import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SearchButton } from "./SearchButton";

describe("SearchButton", () => {
  it("renders an idle submit button, not busy", () => {
    render(<SearchButton />);
    const button = screen.getByRole("button", { name: "Search" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("aria-busy", "false");
  });
});
