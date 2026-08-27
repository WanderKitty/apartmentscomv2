import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center px-6 py-24 text-center">
      <h1 className="text-[28px] font-bold text-ink">
        This listing isn’t here.
      </h1>
      <p className="mt-2 text-[16px] text-muted">
        It may have been rented, or the property took it down. Gone listings
        stay in our price history but no longer have a page.
      </p>
      <Link
        href="/"
        className="mt-6 flex h-12 items-center rounded-[8px] bg-rausch px-6 text-[16px] font-medium text-white transition-colors hover:bg-rausch-active"
      >
        Back to search
      </Link>
    </div>
  );
}
