import type { NextConfig } from "next";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// DATABASE_URL lives in the repo-root .env; Next only auto-loads app-local
// env files, so load the root one for dev/build/start.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const nextConfig: NextConfig = {
  transpilePackages: ["@aptv2/db", "@aptv2/schema", "@aptv2/search"],
};

export default nextConfig;
