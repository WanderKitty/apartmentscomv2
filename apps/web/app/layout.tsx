import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eola — Orlando apartment search",
  description:
    "Search Orlando apartments scraped daily from property websites. Timestamped prices, decoded concessions, nothing rehosted.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-hairline">
          <div className="mx-auto flex h-20 w-full max-w-[1280px] items-center justify-between px-6 md:px-10">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-[22px] font-bold tracking-[-0.44px] text-rausch">
                eola
              </span>
              <span className="hidden text-[13px] text-muted sm:inline">
                Orlando apartment search
              </span>
            </Link>
            <nav className="flex items-center gap-6">
              <Link
                href="/"
                className="text-[16px] font-semibold text-ink hover:underline"
              >
                Search
              </Link>
              <Link
                href="/admin"
                className="text-[16px] font-semibold text-muted hover:text-ink hover:underline"
              >
                Admin
              </Link>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-hairline">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2 px-6 py-8 text-[13px] text-muted md:flex-row md:items-center md:justify-between md:px-10">
            <p>© 2026 Eola · Orlando, FL</p>
            <p>
              Listings come straight from property websites. Photos and
              descriptions stay at the source — we link, never copy.
              Geocoding data © OpenStreetMap contributors.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
