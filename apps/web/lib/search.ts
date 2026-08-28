import "server-only";
import { getPool } from "@aptv2/db";
import { createSearchService } from "@aptv2/search";
import type { SearchService } from "./types";

// SearchService over Postgres. getPool is passed lazily so `next build`
// can import this module without a DATABASE_URL.
export const searchService: SearchService = createSearchService(() => getPool());
