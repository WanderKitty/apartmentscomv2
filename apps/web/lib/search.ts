import "server-only";
import { getPool } from "@aptv2/db";
import { createSearchService } from "@aptv2/search";
import type { SearchService } from "./types";

// The real thing: SearchService over Postgres (spec §3.1 module 4).
// getPool is passed lazily so `next build` can import this module
// without a DATABASE_URL.
export const searchService: SearchService = createSearchService(() => getPool());
