import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// next/form and next/navigation need a mounted App Router; the shims keep
// the form plain and capture router.push so the tests exercise OUR
// dropdown/navigation logic, not Next's internals.
const push = vi.fn();
vi.mock("next/form", () => ({
  default: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const { SearchBar } = await import("./SearchBar");

beforeEach(() => push.mockClear());

describe("SearchBar autosuggest", () => {
  it("shows completions while typing and applies one on click", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox", { name: /search/i });
    fireEvent.change(input, { target: { value: "furnished 2 b" } });
    const option = screen.getByRole("option", { name: /2 bed/ });
    fireEvent.mouseDown(option);
    expect(input).toHaveValue("furnished 2 bed");
  });

  it("supports keyboard selection with arrows and Enter", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox", { name: /search/i });
    fireEvent.change(input, { target: { value: "fur" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("furnished");
  });

  it("navigates with the COMPLETED query, not the stale fragment (regression)", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox", { name: /search/i });
    fireEvent.change(input, { target: { value: "furnished 2 b" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: /2 bed/ }));
    expect(push).toHaveBeenCalledWith(`/?q=${encodeURIComponent("furnished 2 bed")}`);
  });

  it("submitting the form navigates and shows the pending overlay state", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox", { name: /search/i });
    fireEvent.change(input, { target: { value: "2 bed" } });
    fireEvent.submit(input.closest("form")!);
    expect(push).toHaveBeenCalledWith(`/?q=${encodeURIComponent("2 bed")}`);
  });

  it("closes the list on Escape", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox", { name: /search/i });
    fireEvent.change(input, { target: { value: "stu" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
