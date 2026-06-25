import { Link, useSearch } from "@tanstack/react-router";
import { IconChevronLeftMedium } from "central-icons";
import { DialRoot } from "dialkit";
import "dialkit/styles.css";

import {
  DEFAULT_HONKKIT_COMPONENT_ID,
  findHonkKitComponent,
  HONKKIT_CATALOG,
  HONKKIT_COMPONENTS,
} from "~/components/dev/honkkit/catalog";
import { HonkKitPreview } from "~/components/dev/honkkit/previews";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { syncAppearanceVibrancy } from "~/lib/appearance-settings";

export function HonkKitGalleryPage() {
  const search = useSearch({ from: "/dev/honkkit" });

  useMountEffect(() => {
    syncAppearanceVibrancy();
  });

  const requestedComponent = search.component ? findHonkKitComponent(search.component) : undefined;
  const selected =
    requestedComponent ??
    findHonkKitComponent(DEFAULT_HONKKIT_COMPONENT_ID) ??
    HONKKIT_COMPONENTS[0]!;
  const selectedId = selected.id;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-64 min-w-0 flex-col border-r border-honk-stroke-tertiary/60 bg-(--honk-sidebar-surface-background) pt-[var(--honk-shell-sidebar-content-top-offset,var(--honk-electron-traffic-padding-top))] font-honk text-sidebar-label text-honk-fg-secondary">
        <div className="no-drag shrink-0 px-sidebar-gutter pt-1 pb-2">
          <Link
            to="/"
            className="flex min-h-sidebar-item w-full min-w-0 select-none items-center gap-sidebar-item-gap rounded-honk-control px-1.5 py-1 text-left text-honk-fg-secondary transition-colors hover:bg-honk-bg-quaternary hover:text-honk-fg-primary"
          >
            <IconChevronLeftMedium className="size-4 shrink-0 opacity-60" aria-hidden />
            <span className="min-w-0 truncate">Back to chat</span>
          </Link>
        </div>
        <nav
          aria-label="HonkKit components"
          className="no-drag flex min-h-0 flex-1 flex-col gap-sidebar-section-gap overflow-y-auto overscroll-contain px-sidebar-gutter pb-4 [scrollbar-gutter:stable]"
        >
          {HONKKIT_CATALOG.map((group) => (
            <div key={group.id} className="flex flex-col gap-px">
              <div className="px-1.5 py-1 text-[11px] leading-4 font-medium tracking-[0.11em] text-honk-fg-tertiary uppercase">
                {group.label}
              </div>
              <ul className="flex flex-col gap-px">
                {group.components.map((entry) => {
                  const isSelected = entry.id === selectedId;
                  return (
                    <li key={entry.id}>
                      <Link
                        to="/dev/honkkit"
                        search={{ component: entry.id }}
                        aria-current={isSelected ? "page" : undefined}
                        className={
                          isSelected
                            ? "flex min-h-sidebar-item w-full min-w-0 items-center rounded-honk-control bg-honk-bg-quaternary px-1.5 py-1 text-honk-fg-primary"
                            : "flex min-h-sidebar-item w-full min-w-0 items-center rounded-honk-control px-1.5 py-1 text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary"
                        }
                      >
                        <span className="min-w-0 truncate">{entry.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="fixed inset-y-0 right-0 left-64 min-w-0 overflow-hidden bg-[radial-gradient(circle,color-mix(in_srgb,var(--foreground)_10%,transparent)_1px,transparent_1px)] [background-size:20px_20px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-6 pt-[calc(var(--honk-electron-traffic-padding-top)+1rem)] font-honk text-detail font-medium text-honk-fg-tertiary">
          {selected.name}
        </div>
        <div className="h-full min-h-0 overflow-auto overscroll-contain">
          <div className="flex min-h-full w-max min-w-full items-center justify-center p-12 pt-[calc(var(--honk-electron-traffic-padding-top)+var(--honk-header-height)+4rem)]">
            <div className="flex min-w-0 items-center justify-center rounded-[20px] border border-honk-stroke-tertiary/60 bg-honk-bg-secondary/45 p-8 shadow-sm backdrop-blur-sm">
              <HonkKitPreview key={selected.id} componentId={selected.id} />
            </div>
          </div>
        </div>
      </main>

      <DialRoot position="top-right" theme="system" />
    </div>
  );
}
