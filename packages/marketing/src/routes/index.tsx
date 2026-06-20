import { createFileRoute } from "@tanstack/react-router";
import { IconGithub, IconX } from "central-icons";

import { cn } from "@honk/honkkit/utils";

import { AudienceRail } from "../components/audience-rail/audience-rail";
import { DesktopDownloadControls } from "../components/desktop-download-controls";
import { ProductFrame } from "../components/product-frame";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

const socialLinkClassName =
  "inline-flex size-7 items-center justify-center rounded-full text-neutral-500 no-underline transition-colors hover:bg-neutral-200/70 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100";

function MarketingSocialNav({ className }: { className?: string }) {
  return (
    <nav className={cn("flex items-center gap-1", className)}>
      <a
        aria-label="Honk on X"
        className={socialLinkClassName}
        href="https://x.com/d2ac__"
        rel="noopener noreferrer"
        target="_blank"
      >
        <IconX className="size-4 shrink-0" aria-hidden />
      </a>
      <a
        aria-label="Honk on GitHub"
        className={socialLinkClassName}
        href="https://github.com/interfaces-lab/honk"
        rel="noopener noreferrer"
        target="_blank"
      >
        <IconGithub className="size-4 shrink-0" aria-hidden />
      </a>
    </nav>
  );
}

function MarketingHeader() {
  return (
    <header className="relative z-40 flex w-full shrink-0 items-center justify-between gap-6 bg-[#f7f8fb] px-6 py-4 dark:bg-neutral-950 lg:col-span-2">
      <a
        href="/"
        aria-label="Homepage"
        className="flex items-center gap-2 text-lg leading-none font-semibold text-neutral-950 no-underline dark:text-neutral-100"
      >
        <img
          alt=""
          className="size-7 shrink-0 rounded-md"
          height={28}
          src="/apple-touch-icon.png"
          width={28}
        />
        <span>Honk</span>
      </a>
      <MarketingSocialNav />
    </header>
  );
}

function Headline(props: { children: React.ReactNode; className?: string }) {
  return (
    <h1
      className={cn(
        "my-0 text-balance font-sans text-[clamp(2.5rem,4.5vw,4rem)] leading-none font-normal tracking-[-0.06em] text-neutral-950 dark:text-neutral-100",
        props.className,
      )}
    >
      {props.children}
    </h1>
  );
}

function EdgeMask(props: { intensity: "strong" | "soft" }) {
  const size = props.intensity === "strong" ? "55%" : "72%";

  return (
    <div
      aria-hidden="true"
      className="marketing-edge-mask pointer-events-none absolute inset-0 z-10"
      style={{
        background: `radial-gradient(ellipse ${size} ${size} at 50% 50%, var(--marketing-edge-center) 0%, var(--marketing-edge-fade) 100%)`,
      }}
    />
  );
}

function MarketingPage() {
  return (
    <main id="top" className="isolate font-sans">
      <section
        id="product"
        className="mx-auto grid h-svh max-h-svh w-full max-w-[1600px] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[#f7f8fb] select-none lg:grid-cols-[auto_minmax(0,1fr)] dark:bg-neutral-950"
      >
        <MarketingHeader />

        <AudienceRail className="hidden pb-10 pl-6 pr-6 pt-4 lg:flex lg:col-start-1 lg:row-start-2 lg:row-end-4" />

        <div className="@container/product relative z-0 flex min-h-0 w-full min-w-0 items-center justify-center px-4 py-3 sm:px-6 lg:col-start-2 lg:row-start-2">
          <ProductFrame className="relative z-1" />
          <EdgeMask intensity="soft" />
        </div>

        <div className="relative z-20 shrink-0 bg-[#f7f8fb] px-6 py-3 lg:col-start-2 lg:row-start-3 dark:bg-neutral-950">
          <div className="flex w-full flex-col items-end gap-6 lg:flex-row lg:items-end lg:justify-end lg:gap-10">
            <Headline>Build with frontier agents</Headline>
            <DesktopDownloadControls showSectionLabel />
          </div>
        </div>
      </section>
    </main>
  );
}
