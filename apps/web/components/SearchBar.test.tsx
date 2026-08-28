import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// next/form needs a mounted App Router; the shim keeps it a plain <form>
// so the test exercises OUR dropdown logic, not Next's navigation.
vi.mock("next/form", () => ({
  default: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));

const { SearchBar } = await import("./SearchBar");

describe("SearchBar autosuggest", () => {
  it("shows completions while typing and applies one on click", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox", { name: /search/i });
    fireEvent.change(input, { target: { value: "2 bed in bald" } });
    const option = screen.getByRole("option", { name: /Baldwin Park/ });
    fireEvent.mouseDown(option);
    expect(input).toHaveValue("2 bed in Baldwin Park");
  });

  it("supports keyboard selection with arrows and Enter", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox", { name: /search/i });
    fireEvent.change(input, { target: { value: "poo" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("pool");
  });

  it("closes the list on Escape", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox", { name: /search/i });
    fireEvent.change(input, { target: { value: "bald" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
