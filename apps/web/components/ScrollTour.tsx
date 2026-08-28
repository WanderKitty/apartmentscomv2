"use client";
import { useEffect, useRef, useState } from "react";

// Scroll-driven product tour: captions scroll past a sticky frame whose
// product screenshots crossfade as each caption crosses the viewport
// center — a video-like effect from three static images. On mobile the
// frames render inline per step; reduced motion gets instant swaps
// (the transitions live in CSS and are disabled by the media query).

const STEPS = [
  {
    img: "/tour/tour-search.png",
    alt: "Search results with floorplan images and decoded prices",
    title: "Ask in plain English",
    body: "“2 bed near Lake Eola under $2,400” — the search reads it the way you meant it: beds, budget, neighborhood, amenities. Every result straight from the property’s own site.",
  },
  {
    img: "/tour/tour-cost.png",
    alt: "True monthly cost card showing net-effective rent",
    title: "Prices, decoded",
    body: "“Starting at” prices get flagged, and specials are turned into the net rent you’d actually pay — advertised rent, concession, net effective, all shown as plain arithmetic.",
  },
  {
    img: "/tour/tour-history.png",
    alt: "A listing's price history with a recorded price drop and days on market",
    title: "We remember every price",
    body: "Listing sites show today's price; we keep the receipts. Every drop, every increase, and how long a unit has really been sitting — so you know if that “deal” is new or just relisted. When you’re ready, one link takes you straight to the property to apply.",
  },
];

function Frame({ img, alt, className = "" }: { img: string; alt: string; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-card border border-hairline-soft bg-white shadow-tier ${className}`}
    >
      <div className="flex items-center gap-1.5 border-b border-hairline-soft bg-surface-soft px-4 py-2.5" aria-hidden>
        <span className="size-2.5 rounded-full bg-hairline" />
        <span className="size-2.5 rounded-full bg-hairline" />
        <span className="size-2.5 rounded-full bg-hairline" />
      </div>
      <div className="flex h-[calc(100%-33px)] items-center justify-center p-4">
        <img src={img} alt={alt} loading="lazy" className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}

export function ScrollTour() {
  const [active, setActive] = useState(0);
  const captionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = captionRefs.current.indexOf(entry.target as HTMLDivElement);
          if (i >= 0) setActive(i);
        }
      },
      // A caption becomes active when it crosses the middle band of the viewport.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const el of captionRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section aria-label="How it works">
      {/* Desktop: sticky crossfading frame beside scrolling captions. */}
      <div className="hidden gap-12 md:grid md:grid-cols-[5fr_6fr]">
        <div>
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              ref={(el) => {
                captionRefs.current[i] = el;
              }}
              className="flex min-h-[70vh] flex-col justify-center"
            >
              <p className="text-[12px] font-bold uppercase tracking-[1.2px] text-rausch">
                {String(i + 1).padStart(2, "0")}
              </p>
              <h2 className="mt-2 text-[21px] font-bold leading-[1.43] text-ink">
                {step.title}
              </h2>
              <p className="mt-3 max-w-[400px] text-[16px] leading-[1.55] text-body">
                {step.body}
              </p>
            </div>
          ))}
        </div>
        <div className="relative">
          <div className="sticky top-[15vh] h-[70vh]">
            {STEPS.map((step, i) => (
              <Frame
                key={step.img}
                img={step.img}
                alt={step.alt}
                className={`absolute inset-0 transition-all duration-[600ms] ease-[var(--ease-glide)] motion-reduce:transition-none ${
                  i === active
                    ? "z-10 translate-y-0 scale-100 opacity-100"
                    : "z-0 translate-y-3 scale-[0.97] opacity-0"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: inline frames, no sticky choreography. */}
      <div className="flex flex-col gap-14 md:hidden">
        {STEPS.map((step, i) => (
          <div key={step.title}>
            <p className="text-[12px] font-bold uppercase tracking-[1.2px] text-rausch">
              {String(i + 1).padStart(2, "0")}
            </p>
            <h2 className="mt-1 text-[20px] font-semibold leading-[1.2] tracking-[-0.18px] text-ink">{step.title}</h2>
            <p className="mt-2 text-[15px] leading-[1.55] text-body">{step.body}</p>
            <Frame img={step.img} alt={step.alt} className="mt-4 h-72" />
          </div>
        ))}
      </div>
    </section>
  );
}
