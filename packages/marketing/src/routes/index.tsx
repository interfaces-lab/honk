import { createFileRoute } from "@tanstack/react-router";
import { Badge, Button, StatusDot, Switch } from "@honk/ui";
import {
  IconArrowRight,
  IconBrowserTabs,
  IconChanges,
  IconCircleCheck,
  IconSparklesSoft,
} from "central-icons";
import { useState } from "react";

import { DesktopDownloadControls } from "../components/desktop-download-controls";
import { ProductFrame } from "../components/product-frame";
import { cn } from "../lib/classes";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

const navigationItems = [
  { label: "Overview", href: "#overview" },
  { label: "Capabilities", href: "#capabilities" },
  { label: "Product", href: "#product" },
  { label: "Download", href: "#download" },
] as const;

const extensionExamples = [
  { id: "sidebar", label: "Vertical sidebar", detail: "Keep every thread visible" },
  { id: "awake", label: "Keep awake", detail: "Let agents continue while idle" },
  { id: "workbench", label: "Workbench pane", detail: "Add a focused project surface" },
] as const;

const agentTargets = ["Web", "Terminal", "Phone"] as const;

function FusionDemo() {
  const [complete, setComplete] = useState(false);

  return (
    <div className="flex flex-col font-sans">
      <div className="flex items-center justify-between border-b border-marketing-border px-3 py-2">
        <span className="text-detail text-muted">Refactor auth flow</span>
        <Button
          size="sm"
          variant={complete ? "quiet" : "primary"}
          onClick={() => setComplete(!complete)}
        >
          {complete ? "Reset" : "Run"}
        </Button>
      </div>
      <div className="flex items-center gap-2 border-b border-marketing-border px-3 py-2.5">
        <StatusDot tone={complete ? "ok" : "accent"} pulse={!complete} />
        <span className="flex-1 text-body text-primary">Claude</span>
        <span className="text-detail text-muted">{complete ? "Reviewed" : "Reasoning"}</span>
      </div>
      <div className="flex items-center gap-2 border-b border-marketing-border px-3 py-2.5">
        <StatusDot tone={complete ? "ok" : "accent"} pulse={!complete} />
        <span className="flex-1 text-body text-primary">Codex</span>
        <span className="text-detail text-muted">{complete ? "Applied" : "Editing"}</span>
      </div>
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-body text-primary">Combined result</span>
        <Badge size="sm" tone={complete ? "ok" : "neutral"}>
          {complete ? "Ready" : "Working"}
        </Badge>
      </div>
    </div>
  );
}

function ExtensionDemo() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    sidebar: true,
    awake: true,
    workbench: false,
  });

  return (
    <div className="font-sans">
      <p className="border-b border-marketing-border px-3 py-2 text-detail text-muted">
        Extensions
      </p>
      {extensionExamples.map((extension) => (
        <div
          className="flex items-center gap-3 border-b border-marketing-border px-3 py-2.5 last:border-b-0"
          key={extension.id}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-body text-primary">{extension.label}</p>
            <p className="truncate text-detail text-muted">{extension.detail}</p>
          </div>
          <Switch
            aria-label={`Enable ${extension.label}`}
            checked={enabled[extension.id] ?? false}
            onCheckedChange={(checked) =>
              setEnabled((current) => ({ ...current, [extension.id]: checked }))
            }
            size="sm"
          />
        </div>
      ))}
    </div>
  );
}

function SubscriptionsDemo() {
  const [connected, setConnected] = useState({ Claude: true, Codex: true });

  return (
    <div className="font-sans">
      <p className="border-b border-marketing-border px-3 py-2 text-detail text-muted">
        Connected accounts
      </p>
      {(["Claude", "Codex"] as const).map((provider) => (
        <div
          className="flex items-center gap-2 border-b border-marketing-border px-3 py-3 last:border-b-0"
          key={provider}
        >
          <StatusDot tone={connected[provider] ? "ok" : "neutral"} />
          <div className="min-w-0 flex-1">
            <p className="text-body text-primary">{provider}</p>
            <p className="text-detail text-muted">Your subscription</p>
          </div>
          <Button
            size="sm"
            variant="quiet"
            onClick={() =>
              setConnected((current) => ({ ...current, [provider]: !current[provider] }))
            }
          >
            {connected[provider] ? "Connected" : "Connect"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function AgentsAnywhereDemo() {
  const [target, setTarget] = useState<(typeof agentTargets)[number]>("Web");

  return (
    <div className="font-sans">
      <div className="flex items-center gap-1 border-b border-marketing-border p-2">
        {agentTargets.map((agentTarget) => (
          <Button
            aria-pressed={agentTarget === target}
            key={agentTarget}
            size="sm"
            variant={agentTarget === target ? "primary" : "quiet"}
            onClick={() => setTarget(agentTarget)}
          >
            {agentTarget}
          </Button>
        ))}
      </div>
      <div className="px-3 py-3">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-detail text-muted">{target}</span>
          <Badge size="sm" tone="accent">
            Live
          </Badge>
        </div>
        <p className="text-body text-primary">Refactor auth flow</p>
        <div className="mt-3 flex items-center gap-2">
          <StatusDot tone="accent" pulse />
          <span className="text-detail text-muted">Running on your Mac</span>
          <span className="ml-auto font-mono text-micro text-muted">2m 18s</span>
        </div>
      </div>
    </div>
  );
}

function HonkMark() {
  return (
    <img
      alt=""
      className="size-5 shrink-0 rounded-control"
      height={20}
      src="/apple-touch-icon.png"
      width={20}
    />
  );
}

function closeMobileMenu(event: React.MouseEvent<HTMLAnchorElement>) {
  event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
}

function MobileNavigation() {
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 select-none md:hidden">
        <div className="marketing-shell">
          <div className="flex items-center justify-between pt-6 pb-8">
            <a aria-label="Honk home" className="flex" href="#overview">
              <HonkMark />
            </a>
            <button
              className="bg-transparent p-0 font-heading text-[15px] leading-[1.3]"
              popoverTarget="marketing-mobile-navigation"
              type="button"
            >
              Menu
            </button>
          </div>
        </div>
      </div>

      <div
        className="marketing-mobile-menu m-0 size-full border-0 bg-marketing-background p-0 text-marketing-primary"
        id="marketing-mobile-navigation"
        popover="auto"
      >
        <div className="marketing-shell flex h-full flex-col">
          <div className="flex items-center justify-between pt-6 pb-2">
            <a aria-label="Honk home" className="flex" href="#overview" onClick={closeMobileMenu}>
              <HonkMark />
            </a>
            <button
              className="bg-transparent p-0 font-heading text-[15px] leading-[1.3]"
              popoverTarget="marketing-mobile-navigation"
              popoverTargetAction="hide"
              type="button"
            >
              Close
            </button>
          </div>

          <nav aria-label="Mobile navigation" className="mt-1">
            {navigationItems.map((item, index) => (
              <a
                aria-current={index === 0 ? "location" : undefined}
                className={cn(
                  "flex items-center justify-between border-b border-marketing-border py-2 font-heading text-[24px] leading-[1.3] no-underline",
                  index === 0 ? "text-marketing-accent" : "text-marketing-primary",
                )}
                href={item.href}
                key={item.href}
                onClick={closeMobileMenu}
              >
                {item.label}
                {item.label === "Download" ? (
                  <IconArrowRight className="size-5" aria-hidden />
                ) : null}
              </a>
            ))}
            <a
              className="flex items-center justify-between border-b border-marketing-border py-2 font-heading text-[24px] leading-[1.3] text-marketing-primary no-underline"
              href="https://github.com/interfaces-lab/honk"
              rel="noopener noreferrer"
              target="_blank"
            >
              GitHub
              <IconArrowRight className="size-5 -rotate-45" aria-hidden />
            </a>
          </nav>
        </div>
      </div>
    </>
  );
}

function SideNavigation() {
  return (
    <nav
      aria-label="Primary"
      className="sticky top-[212px] z-20 col-start-1 col-span-3 -ml-[18px] hidden -translate-y-16 self-start flex-col items-start gap-4 pb-[320px] select-none md:flex"
    >
      <a aria-label="Honk home" className="ml-[18px] flex size-5" href="#overview">
        <HonkMark />
      </a>

      <div className="flex flex-col gap-3">
        <ol className="flex flex-col">
          {navigationItems.map((item, index) => (
            <li className="group flex items-center gap-2.5 py-px" key={item.href}>
              <span className="flex size-2 shrink-0 items-center justify-center" aria-hidden>
                <span
                  className={cn(
                    "block h-3 w-0.5 translate-x-1",
                    index === 0
                      ? "bg-marketing-accent opacity-100"
                      : "bg-marketing-primary opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none",
                  )}
                />
              </span>
              <a
                aria-current={index === 0 ? "location" : undefined}
                className={cn(
                  "font-heading text-[15px] leading-[1.3] no-underline transition-colors motion-reduce:transition-none",
                  index === 0
                    ? "text-marketing-accent"
                    : "text-marketing-primary hover:text-marketing-accent",
                )}
                href={item.href}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ol>

        <a
          className="ml-[18px] flex h-7 w-fit items-center justify-center border border-marketing-primary bg-transparent px-2 pb-px font-heading text-[15px] leading-[1.3] text-marketing-primary no-underline transition-colors hover:bg-marketing-primary hover:text-marketing-background motion-reduce:transition-none"
          href="#download"
        >
          Download
        </a>
      </div>
    </nav>
  );
}

function GridGuides() {
  return (
    <div
      className="marketing-grid-guides pointer-events-none absolute inset-0 z-0 grid"
      aria-hidden
    >
      <span className="marketing-grid-line col-start-1 border-l border-marketing-border" />
      <span className="marketing-grid-line col-start-4 hidden border-l border-marketing-border md:block" />
      <span className="marketing-grid-line col-start-5 hidden border-l border-marketing-border md:block" />
      <span className="marketing-grid-line col-start-13 hidden border-l border-marketing-border md:block" />
      <span className="marketing-grid-line col-start-6 border-r border-marketing-border md:col-start-15 md:border-r-0 md:border-l" />
    </div>
  );
}

function FunctionCell(props: {
  children: React.ReactNode;
  className?: string;
  demoClassName?: string;
  description: string;
  icon: React.ReactNode;
  number: string;
  title: string;
}) {
  return (
    <article
      className={cn(
        "relative h-[360px] overflow-hidden border-r border-b border-marketing-border p-5 md:h-[340px] md:p-6",
        props.className,
      )}
    >
      <div className="relative z-10 flex items-start justify-between gap-4">
        <span className="text-marketing-secondary">{props.icon}</span>
        <span className="font-mono text-[9px] leading-[1.5] text-marketing-secondary">
          {props.number}
        </span>
      </div>
      <div className="relative z-10 mt-5 max-w-[420px]">
        <h3 className="font-heading text-[24px] leading-[1.15] tracking-[-0.02em] md:text-[28px]">
          {props.title}
        </h3>
        <p className="mt-2 max-w-[300px] font-body text-[15px] leading-[1.5] text-marketing-secondary">
          {props.description}
        </p>
      </div>
      <div
        aria-label={`${props.title} interactive demo`}
        role="group"
        className={cn(
          "marketing-component-demo honk-marketing-preview absolute bottom-0 z-0 w-[calc(100%_-_40px)] overflow-hidden border-t border-marketing-border bg-marketing-background md:w-[72%]",
          props.demoClassName,
        )}
      >
        {props.children}
      </div>
    </article>
  );
}

function SectionNumber(props: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "col-start-1 hidden font-body text-[10px] leading-[1.5] text-marketing-secondary select-none md:block",
        props.className,
      )}
    >
      {props.children}
    </p>
  );
}

function MarketingPage() {
  return (
    <main className="min-h-screen bg-marketing-background font-body text-marketing-primary">
      <MobileNavigation />

      <div className="marketing-shell">
        <div className="marketing-content-grid relative">
          <GridGuides />
          <SideNavigation />

          <div className="relative z-10 col-start-1 col-span-6 grid grid-cols-6 md:col-start-4 md:col-span-12 md:grid-cols-12">
            <SectionNumber>01</SectionNumber>
            <section
              id="overview"
              className="col-start-1 col-span-6 flex scroll-mt-24 flex-col gap-3 md:col-start-2 md:col-span-7 md:scroll-mt-0 md:gap-5"
            >
              <h1 className="max-w-[490px] font-heading text-[24px] leading-[1.2] font-normal tracking-[-0.02em] md:max-w-none md:text-[36px] md:leading-[1.1]">
                Honk keeps Claude, Codex, and every coding task in one workspace.
              </h1>
              <p className="font-body text-[16px] leading-[1.5]">
                Run several tasks at once without flattening them into one chat. Each task keeps its
                own thread, project context, status, tool calls, and file changes.
              </p>
              <p className="font-body text-[16px] leading-[1.5]">
                Honk works directly in the project on your Mac. Move between active agents, review
                what changed, and send the next instruction from the same clear interface.
              </p>
            </section>

            <SectionNumber className="mt-12">02</SectionNumber>
            <section
              id="capabilities"
              className="col-start-1 col-span-6 mt-12 scroll-mt-24 md:col-start-2 md:col-span-10 md:scroll-mt-0"
            >
              <div className="flex max-w-[600px] flex-col gap-1">
                <h2 className="font-heading text-[18px] leading-[1.3] tracking-[-0.01em] md:text-[20px]">
                  What makes Honk different
                </h2>
                <p className="font-body text-[15px] leading-[1.5] text-marketing-secondary">
                  The product architecture, not a logo wall: paired models, extensible surfaces,
                  existing accounts, and one runtime across every device.
                </p>
              </div>

              <div className="mt-6 grid grid-cols-6 border-t border-l border-marketing-border bg-marketing-panel md:grid-cols-10 md:grid-rows-[repeat(2,340px)]">
                <FunctionCell
                  className="col-span-6 md:col-start-1 md:row-start-1"
                  demoClassName="right-0 border-l border-marketing-border md:w-[68%]"
                  description="Pair Claude and Codex on the same task, each handling the part it does best."
                  icon={<IconSparklesSoft className="size-4" />}
                  number="02.1"
                  title="Fusion models"
                >
                  <FusionDemo />
                </FunctionCell>

                <FunctionCell
                  className="col-span-6 md:col-start-7 md:row-start-1 md:col-span-4"
                  demoClassName="right-0 border-l border-marketing-border md:w-[76%]"
                  description="Add sidebars, panes, settings, and behaviors without forking the app."
                  icon={<IconChanges className="size-4" />}
                  number="02.2"
                  title="Extension system"
                >
                  <ExtensionDemo />
                </FunctionCell>

                <FunctionCell
                  className="col-span-6 md:col-start-1 md:row-start-2 md:col-span-4"
                  demoClassName="right-0 border-l border-marketing-border md:w-[78%]"
                  description="Connect Claude and Codex and use the plans you already pay for."
                  icon={<IconCircleCheck className="size-4" />}
                  number="02.3"
                  title="Bring your subscriptions"
                >
                  <SubscriptionsDemo />
                </FunctionCell>

                <FunctionCell
                  className="col-span-6 md:col-start-5 md:row-start-2 md:col-span-6"
                  demoClassName="right-0 border-l border-marketing-border md:w-[68%]"
                  description="Start agents on the web, in your terminal, or from your phone."
                  icon={<IconBrowserTabs className="size-4" />}
                  number="02.4"
                  title="Use Agents Anywhere"
                >
                  <AgentsAnywhereDemo />
                </FunctionCell>
              </div>
            </section>

            <SectionNumber>03</SectionNumber>
            <section
              id="product"
              className="col-start-1 col-span-6 flex scroll-mt-24 flex-col pt-12 md:col-start-2 md:col-span-10 md:scroll-mt-0"
            >
              <h2 className="font-heading text-[18px] leading-[1.3] tracking-[-0.01em] md:text-[20px]">
                The product, not a mockup
              </h2>
              <p className="mt-1 max-w-[600px] font-body text-[15px] leading-[1.5] text-marketing-secondary">
                Open a thread or send a prompt. The preview uses the same shell, tabs, tool calls,
                and composer as the desktop app.
              </p>
              <div className="mt-6 border border-marketing-border bg-marketing-surface p-2 md:p-4">
                <ProductFrame />
              </div>
            </section>

            <SectionNumber>04</SectionNumber>
            <section
              id="download"
              className="col-start-1 col-span-6 flex scroll-mt-24 flex-col gap-6 border-t border-marketing-border pt-8 pb-12 md:col-start-2 md:col-span-10 md:scroll-mt-0 md:flex-row md:items-end md:justify-between"
            >
              <div className="max-w-[600px]">
                <h2 className="font-heading text-[18px] leading-[1.3] tracking-[-0.01em] md:text-[20px]">
                  Put every coding task in one place
                </h2>
                <p className="mt-1 font-body text-[15px] leading-[1.5] text-marketing-secondary">
                  Download Honk for Apple silicon or Intel. Connect an account, open a project, and
                  start a thread.
                </p>
              </div>
              <DesktopDownloadControls />
            </section>
          </div>

          <footer className="relative z-10 col-start-1 col-span-6 grid grid-cols-6 border-t border-marketing-border py-8 md:col-span-full md:grid-cols-15 md:pb-24">
            <div className="col-start-1 col-span-6 flex flex-col gap-5 md:col-start-1 md:col-span-15 md:flex-row md:items-center md:justify-between">
              <span className="flex items-center gap-2.5 font-heading text-[13px]">
                <HonkMark />
                Honk
              </span>
              <nav aria-label="Footer links" className="flex gap-5 font-heading text-[13px]">
                <a
                  className="text-marketing-secondary no-underline hover:text-marketing-primary"
                  href="https://github.com/interfaces-lab/honk"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  GitHub
                </a>
                <a
                  className="text-marketing-secondary no-underline hover:text-marketing-primary"
                  href="https://x.com/d2ac__"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  X
                </a>
                <a
                  className="text-marketing-secondary no-underline hover:text-marketing-primary"
                  href="https://github.com/interfaces-lab/honk/releases"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Releases
                </a>
              </nav>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}
