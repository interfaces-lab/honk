import { Input } from "@multi/ui/input";
import { Text } from "@multi/ui/text";
import { DialRoot } from "dialkit";
import "dialkit/styles.css";
import { useMemo, useState } from "react";

import {
  DEFAULT_TOMETO_COMPONENT_ID,
  findTomeitoComponent,
  TOMETO_CATALOG,
  TOMETO_COMPONENTS,
} from "~/components/dev/tomeito/catalog";
import { TomeitoPreview } from "~/components/dev/tomeito/previews";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { syncAppearanceVibrancy } from "~/lib/appearance-settings";
import { cn } from "~/lib/utils";

export function TomeitoGalleryPage() {
  const [selectedId, setSelectedId] = useState(DEFAULT_TOMETO_COMPONENT_ID);
  const [query, setQuery] = useState("");

  useMountEffect(() => {
    syncAppearanceVibrancy();
  });

  const selected = findTomeitoComponent(selectedId) ?? TOMETO_COMPONENTS[0]!;

  const filteredCatalog = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return TOMETO_CATALOG;
    }

    return TOMETO_CATALOG.map((group) => ({
      ...group,
      components: group.components.filter((entry) => {
        const haystack = [entry.name, entry.id, entry.importPath].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    })).filter((group) => group.components.length > 0);
  }, [query]);

  return (
    <div className="flex h-full min-h-0 w-full !flex-row overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-multi-stroke-tertiary/60 bg-background">
        <div className="border-b border-multi-stroke-tertiary/60 px-3 py-3">
          <Text size="sm" weight="semibold">
            Tomeito
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
              <Text
                size="xs"
                tone="tertiary"
                weight="medium"
                className="px-2 py-1 uppercase tracking-wide"
              >
                {group.label}
              </Text>
              <ul>
                {group.components.map((entry) => {
                  const isSelected = entry.id === selectedId;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(entry.id)}
                        className={cn(
                          "w-full rounded-multi-control px-2 py-1.5 text-left text-sm transition-colors",
                          isSelected
                            ? "bg-multi-bg-tertiary text-multi-fg-primary"
                            : "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary",
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
          <TomeitoPreview key={selected.id} componentId={selected.id} />
        </div>
      </main>

      <DialRoot position="top-right" defaultOpen theme="system" />
    </div>
  );
}
