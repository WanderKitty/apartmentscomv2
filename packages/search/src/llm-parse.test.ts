import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetParseCacheForTests, parseQueryWith } from "./llm-parse";

const LLM_OUT = {
  neighborhoods: ["Lake Eola Heights"],
  cities: [],
  price_max_dollars: 2400,
  beds_min: 2,
  beds_max: 2,
  furnished: null,
  short_term: null,
  amenities: ["pet friendly", "in-unit laundry"],
  sort: "relevance" as const,
  residual_text: "",
};

function fakeClient(parsed: unknown, delayMs = 0) {
  return {
    messages: {
      parse: vi.fn(async () => {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return { parsed_output: parsed };
      }),
    },
  };
}

beforeEach(() => __resetParseCacheForTests());

describe("parseQueryWith", () => {
  it("maps the demo query's LLM output onto ParsedQuery", async () => {
    const p = await parseQueryWith("pet friendly 2br under $2400 near Lake Eola with in-unit laundry", fakeClient(LLM_OUT) as never);
    expect(p.parseSource).toBe("llm");
    expect(p.neighborhoods).toEqual(["Lake Eola Heights"]);
    expect(p.priceMax).toBe(2400);
    expect(p.bedsMin).toBe(2);
    expect(p.amenities).toEqual(["pet friendly", "in-unit laundry"]);
    expect(p.failedOpen).toBe(false);
  });

  it("serves the second identical query from cache", async () => {
    const client = fakeClient(LLM_OUT);
    await parseQueryWith("2br near lake eola", client as never);
    const second = await parseQueryWith("  2BR   near Lake Eola ", client as never); // normalization collapses these
    expect(second.parseSource).toBe("cache");
    expect(client.messages.parse).toHaveBeenCalledTimes(1);
  });

  it("falls open to the keyword parser when the LLM returns null", async () => {
    const p = await parseQueryWith("2br in baldwin park", fakeClient(null) as never);
    expect(p.parseSource).toBe("fallback");
    expect(p.bedsMin).toBe(2); // keyword rung still extracted it
  });

  it("falls open on timeout without throwing", async () => {
    const p = await parseQueryWith("studio downtown", fakeClient(LLM_OUT, 5000) as never, { timeoutMs: 50 });
    expect(p.parseSource).toBe("fallback");
  });

  it("falls open when no client can be constructed (no API key)", async () => {
    const p = await parseQueryWith("1br mills 50", null, {});
    expect(p.parseSource).toBe("fallback");
  });

  it("maps sort ordering intent from the LLM output", async () => {
    const out = { ...LLM_OUT, price_max_dollars: null, sort: "price_asc" as const, residual_text: "" };
    const p = await parseQueryWith("cheapest near lake eola", fakeClient(out) as never);
    expect(p.sort).toBe("price_asc");
    expect(p.priceMax).toBeNull(); // "cheapest" is an ordering, never a price cap
  });
});
