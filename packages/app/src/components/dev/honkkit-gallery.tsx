import { Input } from "@honk/honkkit/input";
import { Text } from "@honk/honkkit/text";
import { normalizeSearchQuery } from "@honk/shared/search-ranking";
import { DialRoot } from "dialkit";
import "dialkit/styles.css";
import { useState } from "react";

import {
  DEFAULT_HONKKIT_COMPONENT_ID,
  findHonkKitComponent,
  HONKKIT_CATALOG,
  HONKKIT_COMPONENTS,
} from "~/components/dev/honkkit/catalog";
import { HonkKitPreview } from "~/components/dev/honkkit/previews";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { syncAppearanceVibrancy } from "~/lib/appearance-settings";
import { cn } from "~/lib/utils";

function readInitialComponentId() {
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("component") ?? window.location.hash.slice(1);
  return candidate && findHonkKitComponent(candidate) ? candidate : DEFAULT_HONKKIT_COMPONENT_ID;
}

function writeComponentId(componentId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("component", componentId);
  url.hash = "";
  window.history.replaceState(null, "", url);
}

export function HonkKitGalleryPage() {
  const [selectedId, setSelectedId] = useState(readInitialComponentId);
  const [query, setQuery] = useState("");

  useMountEffect(() => {
    syncAppearanceVibrancy();
  });

  const selected = findHonkKitComponent(selectedId) ?? HONKKIT_COMPONENTS[0]!;

  function selectComponent(componentId: string) {
    setSelectedId(componentId);
    writeComponentId(componentId);
  }

  const filteredCatalog = (() => {
    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) {
      return HONKKIT_CATALOG;
    }

    return HONKKIT_CATALOG.map((group) => ({
      ...group,
      components: group.components.filter((entry) => {
        const haystack = normalizeSearchQuery([entry.name, entry.id, entry.importPath].join(" "));
        return haystack.includes(normalizedQuery);
      }),
    })).filter((group) => group.components.length > 0);
  })();

  return (
    <div className="flex h-full min-h-0 w-full !flex-row overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-honk-stroke-tertiary/60 bg-background">
        <div className="border-b border-honk-stroke-tertiary/60 px-3 py-3">
          <Text size="sm" weight="semibold">
            HonkKit
          </Text>
        </div>
        <div className="p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter"
            size="sm"
            className="w-full"
          />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {filteredCatalog.map((group) => (
            <div key={group.id} className="mb-4 last:mb-0">
              <div className="px-2 py-1 uppercase tracking-wide">
                <Text size="xs" tone="tertiary" weight="medium">
                  {group.label}
                </Text>
              </div>
              <ul>
                {group.components.map((entry) => {
                  const isSelected = entry.id === selectedId;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => selectComponent(entry.id)}
                        className={cn(
                          "w-full rounded-honk-control px-2 py-1.5 text-left text-sm transition-colors",
                          isSelected
                            ? "bg-honk-bg-tertiary text-honk-fg-primary"
                            : "text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary",
                        )}
                      >
                        {entry.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[radial-gradient(circle,color-mix(in_srgb,var(--foreground)_10%,transparent)_1px,transparent_1px)] [background-size:20px_20px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-6 py-4">
          <Text size="sm" tone="tertiary" weight="medium">
            {selected.name}
          </Text>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-12">
          <HonkKitPreview key={selected.id} componentId={selected.id} />
        </div>
      </main>

      <DialRoot position="top-right" defaultOpen theme="system" />
    </div>
  );
}
