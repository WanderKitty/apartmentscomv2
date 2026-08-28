import { Hero } from "@/components/Hero";

// The statically-prerendered landing page. A beforeFiles rewrite in
// next.config.ts serves this for `/` whenever no ?q= is present, so the
// most-visited page comes from the CDN instead of a lambda render; `/`
// with a query falls through to the dynamic search page. It reads no
// data, so static can never be stale.
export const metadata = { robots: { index: false } }; // canonical URL is /

export default function HeroPage() {
  return <Hero />;
}
