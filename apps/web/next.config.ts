import type { NextConfig } from "next";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// DATABASE_URL lives in the repo-root .env; Next only auto-loads app-local
// env files, so load the root one for dev/build/start.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const nextConfig: NextConfig = {
  transpilePackages: ["@aptv2/db", "@aptv2/schema", "@aptv2/search"],
  // `/` without a query is the statically-prerendered hero (CDN-served, no
  // lambda render, no data to go stale); `/` with ?q= falls through to the
  // dynamic search page. URLs never change for visitors.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          missing: [{ type: "query", key: "q" }],
          destination: "/hero",
        },
      ],
    };
  },
};

export default nextConfig;
