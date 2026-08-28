import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// jsdom has no requestSubmit; dispatch a real submit event so the accept
// path is exercised end-to-end (this is what next/form hooks into).
beforeAll(() => {
  HTMLFormElement.prototype.requestSubmit ??= function (this: HTMLFormElement) {
    this.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };
});

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

  it("submits the COMPLETED query, not the stale fragment (regression)", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox", { name: /search/i });
    const form = input.closest("form")!;
    let submitted: FormDataEntryValue | null = null;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      // next/form reads FormData synchronously inside the submit event —
      // whatever is in the DOM at this instant is what gets navigated to.
      submitted = new FormData(form).get("q");
    });
    fireEvent.change(input, { target: { value: "furnished 2 b" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: /2 bed/ }));
    expect(submitted).toBe("furnished 2 bed");
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
