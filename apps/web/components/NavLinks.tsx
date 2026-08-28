"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Search" },
  { href: "/admin", label: "Admin" },
] as const;

/** Product tabs per the reference doc: nav-link type, 2px ink underline on the active tab. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-6">
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`border-b-2 pb-1 text-[16px] font-semibold leading-[1.25] transition-colors duration-[var(--duration-micro)] ${
              active
                ? "border-ink text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
