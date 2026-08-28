import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

// The reference design system runs Airbnb Cereal VF (proprietary — we can't
// ship it). Inter is the doc's own named substitute; Cereal/Circular stay
// first in the stack for anyone who has them installed.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Eola — Orlando apartment search",
  description:
    "Search Orlando apartments scraped straight from property websites. Timestamped prices, decoded concessions, nothing rehosted.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
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
            <NavLinks />
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-hairline">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2 px-6 py-8 text-[13px] text-muted md:flex-row md:items-center md:justify-between md:px-10">
            <p>© 2026 Eola · Orlando, FL</p>
            <p>
              Listings come straight from property websites. Photos and
              descriptions stay at the source — we link, never copy.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
