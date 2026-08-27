// The neighborhood and amenity taxonomy. Feeds the LLM parser's closed
// enums (spec §6.1) and the keyword-fallback matcher.

export const NEIGHBORHOOD_ALIASES: Record<string, string[]> = {
  "Lake Eola Heights": ["lake eola heights", "lake eola", "eola"],
  "Thornton Park": ["thornton park"],
  "Downtown Orlando": ["downtown orlando", "downtown", "cbd"],
  "Mills 50": ["mills 50", "mills fifty"],
  "College Park": ["college park"],
  "Baldwin Park": ["baldwin park"],
  SoDo: ["sodo", "south downtown"],
  "Audubon Park": ["audubon park"],
  "Lake Nona": ["lake nona"],
};

export const AMENITY_KEYWORDS: Record<string, string[]> = {
  pool: ["pool"],
  gym: ["gym", "fitness"],
  "in-unit laundry": ["in-unit laundry", "washer", "laundry"],
  "pet friendly": ["pet friendly", "pets", "dog", "cat"],
  parking: ["parking", "garage"],
  balcony: ["balcony"],
};
