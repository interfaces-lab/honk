import { useMemo, useState, useCallback, useRef } from "react";
import {
  IconCheckmark1Small,
  IconChevronRightMedium,
  IconMagnifyingGlass,
  IconSettingsKnob,
  IconStar,
} from "central-icons";

import { Button } from "@multi/ui/button";
import {
  Combobox,
  ComboboxInput,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
} from "@multi/ui/combobox";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "@multi/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@multi/ui/popover";
import { ScrollArea } from "@multi/ui/scroll-area";
import { cn } from "~/lib/utils";
import { ProviderInstanceIcon } from "~/components/chat/picker/instance-icon";
import {
  getDisplayModelName,
  getTriggerDisplayModelLabel,
  PROVIDER_ICON_BY_PROVIDER,
} from "~/components/chat/picker/icon-utils";
import type { ProviderInstanceEntry } from "~/provider-instances";
import type { ProviderInstanceId, ProviderDriverKind, ServerProvider } from "@multi/contracts";
import { createModelCapabilities } from "@multi/shared/model";

/* ------------------------------------------------------------------ */
/*  Mock Data                                                         */
/* ------------------------------------------------------------------ */

function selectDescriptor(
  id: string,
  label: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
) {
  return {
    id,
    label,
    type: "select" as const,
    options: [...options],
    ...(options.find((option) => option.isDefault)?.id
      ? { currentValue: options.find((option) => option.isDefault)?.id }
      : {}),
  };
}

function booleanDescriptor(id: string, label: string) {
  return { id, label, type: "boolean" as const };
}

const MOCK_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    driver: "codex" as ProviderDriverKind,
    instanceId: "codex" as ProviderInstanceId,
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("reasoningEffort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
              { id: "xhigh", label: "extra high" },
            ]),
            booleanDescriptor("fastMode", "Fast Mode"),
          ],
        }),
      },
      {
        slug: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("reasoningEffort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
              { id: "xhigh", label: "extra high" },
            ]),
            booleanDescriptor("fastMode", "Fast Mode"),
          ],
        }),
      },
    ],
  },
  {
    driver: "claudeAgent" as ProviderDriverKind,
    instanceId: "claudeAgent" as ProviderInstanceId,
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
              { id: "max", label: "max" },
            ]),
            booleanDescriptor("thinking", "Thinking"),
          ],
        }),
      },
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
              { id: "max", label: "max" },
            ]),
            booleanDescriptor("thinking", "Thinking"),
          ],
        }),
      },
      {
        slug: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
            ]),
            booleanDescriptor("thinking", "Thinking"),
          ],
        }),
      },
    ],
  },
  {
    driver: "opencode" as ProviderDriverKind,
    instanceId: "opencode" as ProviderInstanceId,
    displayName: "OpenCode",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "github-copilot/claude-opus-4.7",
        name: "Claude Opus 4.7",
        subProvider: "GitHub Copilot",
        shortName: "Opus 4.7",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("reasoningEffort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
            ]),
          ],
        }),
      },
    ],
  },
  {
    driver: "cursor" as ProviderDriverKind,
    instanceId: "cursor" as ProviderInstanceId,
    displayName: "Cursor",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "composer-2",
        name: "Composer 2",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
  },
];

function buildInstanceEntries(): ProviderInstanceEntry[] {
  return MOCK_PROVIDERS.map((snapshot) => ({
    instanceId: snapshot.instanceId,
    driverKind: snapshot.driver,
    displayName: snapshot.displayName ?? snapshot.instanceId,
    accentColor: undefined,
    continuationGroupKey: snapshot.continuation?.groupKey,
    enabled: snapshot.enabled,
    installed: snapshot.installed,
    status: snapshot.status,
    isDefault: true,
    isAvailable: true,
    snapshot,
    models: snapshot.models,
  }));
}

/* ------------------------------------------------------------------ */
/*  Shared State Hook                                                 */
/* ------------------------------------------------------------------ */

type FavoriteKey = { provider: ProviderInstanceId; model: string };

function useMockModelPickerState() {
  const instances = useMemo(() => buildInstanceEntries(), []);
  const [selectedKey, setSelectedKey] = useState<string>("claudeAgent:claude-opus-4-6");
  const [favorites, setFavorites] = useState<FavoriteKey[]>([
    { provider: "codex" as ProviderInstanceId, model: "gpt-5-codex" },
  ]);

  const selectedInstanceId = selectedKey.split(":")[0] as ProviderInstanceId;
  const selectedSlug = selectedKey.split(":").slice(1).join(":");

  const selectedEntry = instances.find((i) => i.instanceId === selectedInstanceId);
  const selectedModel = selectedEntry?.models.find((m) => m.slug === selectedSlug);

  const toggleFavorite = useCallback((instanceId: ProviderInstanceId, slug: string) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.provider === instanceId && f.model === slug);
      if (exists) {
        return prev.filter((f) => !(f.provider === instanceId && f.model === slug));
      }
      return [...prev, { provider: instanceId, model: slug }];
    });
  }, []);

  const isFavorite = useCallback(
    (instanceId: ProviderInstanceId, slug: string) => {
      return favorites.some((f) => f.provider === instanceId && f.model === slug);
    },
    [favorites],
  );

  const selectModel = useCallback((instanceId: ProviderInstanceId, slug: string) => {
    setSelectedKey(`${instanceId}:${slug}`);
  }, []);

  return {
    instances,
    selectedKey,
    selectedEntry,
    selectedModel,
    selectedInstanceId,
    selectedSlug,
    favorites,
    toggleFavorite,
    isFavorite,
    selectModel,
  };
}

/* ------------------------------------------------------------------ */
/*  Shared UI Components                                              */
/* ------------------------------------------------------------------ */

function TriggerButton({
  entry,
  model,
  onClick,
}: {
  entry?: ProviderInstanceEntry | undefined;
  model?:
    | {
        slug: string;
        name: string;
        shortName?: string | undefined;
        subProvider?: string | undefined;
      }
    | undefined;
  onClick?: (() => void) | undefined;
}) {
  const label = model ? getTriggerDisplayModelLabel(model) : "Select model";
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      className="h-7 gap-1.5 rounded-full border border-multi-stroke-tertiary bg-multi-bg-quinary px-3 text-body text-multi-fg-secondary"
    >
      {entry ? (
        <ProviderInstanceIcon
          driverKind={entry.driverKind}
          displayName={entry.displayName}
          className="size-4"
          iconClassName="size-4"
        />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
      <IconChevronRightMedium className="size-3 shrink-0 rotate-90 opacity-60" />
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Variant 1: Menu Shell + Combobox Rail                             */
/*  Menu owns the popup. Inside: persistent provider rail + inline    */
/*  Combobox for models. One click on any provider updates the list.  */
/*  No drill-down. No context switch.                                 */
/* ------------------------------------------------------------------ */

function MenuComboboxRailModelPicker() {
  const state = useMockModelPickerState();
  const [open, setOpen] = useState(false);
  const [railSelection, setRailSelection] = useState<ProviderInstanceId>(state.selectedInstanceId);
  const [query, setQuery] = useState("");
  const highlightedKeyRef = useRef<string | null>(null);

  const activeEntry = state.instances.find((i) => i.instanceId === railSelection);

  const allModelKeys = useMemo(() => {
    if (!activeEntry) return [];
    return activeEntry.models.map((m) => `${activeEntry.instanceId}:${m.slug}`);
  }, [activeEntry]);

  const filteredModels = useMemo(() => {
    if (!activeEntry) return [];
    const q = query.trim().toLowerCase();
    if (!q) return activeEntry.models;
    return activeEntry.models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q) ||
        activeEntry.displayName.toLowerCase().includes(q),
    );
  }, [activeEntry, query]);

  const filteredModelKeys = useMemo(() => {
    if (!activeEntry) return [];
    return filteredModels.map((m) => `${activeEntry.instanceId}:${m.slug}`);
  }, [activeEntry, filteredModels]);

  const handleSelect = useCallback(
    (modelKey: string) => {
      const colonIndex = modelKey.indexOf(":");
      const instanceId = modelKey.slice(0, colonIndex) as ProviderInstanceId;
      const slug = modelKey.slice(colonIndex + 1);
      state.selectModel(instanceId, slug);
      setOpen(false);
      setQuery("");
    },
    [state],
  );

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={<TriggerButton entry={state.selectedEntry} model={state.selectedModel} />}
      />
      <MenuPopup
        variant="workbench"
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-[300px] !p-0"
      >
        <div className="flex max-h-[min(17rem,var(--available-height))]">
          {/* Provider rail */}
          <div className="flex w-12 shrink-0 flex-col border-r border-multi-stroke-tertiary bg-multi-bg-secondary-wash">
            <ScrollArea
              hideScrollbars
              scrollFade
              className="max-h-[min(17rem,var(--available-height))]"
            >
              <div className="flex flex-col gap-1 p-1">
                {state.instances.map((entry) => (
                  <button
                    key={entry.instanceId}
                    type="button"
                    onClick={() => {
                      setRailSelection(entry.instanceId);
                      setQuery("");
                    }}
                    className={cn(
                      "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-multi-control transition-colors hover:bg-multi-bg-quaternary",
                      railSelection === entry.instanceId &&
                        "bg-multi-bg-active text-multi-fg-primary shadow-sm",
                    )}
                  >
                    <ProviderInstanceIcon
                      driverKind={entry.driverKind}
                      displayName={entry.displayName}
                      className="size-6"
                      iconClassName="size-5"
                    />
                    {railSelection === entry.instanceId && (
                      <div className="pointer-events-none absolute -right-1 top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary" />
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Combobox model list */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Combobox
              inline
              items={allModelKeys}
              filteredItems={filteredModelKeys}
              filter={null}
              autoHighlight
              open
              value={state.selectedKey}
              onItemHighlighted={(key) => {
                highlightedKeyRef.current = typeof key === "string" ? key : null;
              }}
              onValueChange={(key) => {
                if (typeof key === "string") handleSelect(key);
              }}
            >
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-multi-stroke-tertiary px-1.5 py-1.5">
                  <ComboboxInput
                    className="[&_input]:font-sans"
                    inputClassName="h-7 rounded-multi-control border-0 bg-multi-editor px-2 text-body shadow-none ring-0 placeholder:text-multi-fg-tertiary focus-visible:ring-0"
                    placeholder="Search models..."
                    showTrigger={false}
                    startAddon={
                      <IconMagnifyingGlass className="size-3.5 shrink-0 text-multi-fg-tertiary" />
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpen(false);
                        return;
                      }
                      if (e.key === "Enter" && highlightedKeyRef.current) {
                        (
                          e as typeof e & { preventBaseUIHandler?: () => void }
                        ).preventBaseUIHandler?.();
                        e.preventDefault();
                        e.stopPropagation();
                        handleSelect(highlightedKeyRef.current);
                        return;
                      }
                      e.stopPropagation();
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    size="sm"
                  />
                </div>
                <ScrollArea className="max-h-[min(13rem,calc(var(--available-height)-3rem))]">
                  <ComboboxList className="px-1 pb-1">
                    {filteredModelKeys.map((modelKey) => {
                      const colonIndex = modelKey.indexOf(":");
                      const slug = modelKey.slice(colonIndex + 1);
                      const model = activeEntry!.models.find((m) => m.slug === slug);
                      if (!model) return null;
                      const isSelected = state.selectedKey === modelKey;
                      const isFav = state.isFavorite(activeEntry!.instanceId, model.slug);
                      const ProviderIcon =
                        PROVIDER_ICON_BY_PROVIDER[activeEntry!.driverKind] ?? null;
                      const providerLabel = model.subProvider
                        ? `${activeEntry!.displayName} \u00b7 ${model.subProvider}`
                        : activeEntry!.displayName;

                      return (
                        <ComboboxItem
                          key={modelKey}
                          value={modelKey}
                          hideIndicator
                          className={cn(
                            "group cursor-pointer rounded-multi-control px-1.5 py-1 text-body transition-colors",
                            isSelected
                              ? "bg-multi-bg-active text-multi-fg-primary"
                              : "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary data-highlighted:bg-multi-bg-quaternary data-highlighted:text-multi-fg-primary",
                          )}
                          contentClassName="flex w-full items-start gap-1.5"
                        >
                          <span className="mt-px flex size-4 shrink-0 items-center justify-center text-multi-fg-secondary">
                            <IconCheckmark1Small
                              className={cn("size-3.5", isSelected ? "opacity-100" : "opacity-0")}
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center justify-between gap-1.5">
                              <span className="truncate text-body font-medium">
                                {getDisplayModelName(model, { preferShortName: true })}
                              </span>
                              <button
                                type="button"
                                aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                                aria-pressed={isFav}
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-multi-fg-tertiary opacity-85 transition-colors hover:bg-multi-bg-active hover:text-amber-700 hover:opacity-100 dark:hover:text-amber-300"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  state.toggleFavorite(activeEntry!.instanceId, model.slug);
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                              >
                                <IconStar
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    isFav ? "fill-amber-500 text-amber-500" : "opacity-95",
                                  )}
                                />
                              </button>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1">
                              {ProviderIcon ? <ProviderIcon className="size-3 shrink-0" /> : null}
                              <span className="truncate text-detail text-multi-fg-tertiary">
                                {providerLabel}
                              </span>
                            </div>
                          </div>
                        </ComboboxItem>
                      );
                    })}
                  </ComboboxList>
                </ScrollArea>
                <ComboboxEmpty className="py-3 text-xs text-multi-fg-tertiary">
                  No models found
                </ComboboxEmpty>
              </div>
            </Combobox>
          </div>
        </div>
      </MenuPopup>
    </Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  Variant 2: Combobox Grouped                                       */
/*  Pure Combobox. Flat list grouped by provider with sticky labels.  */
/*  Search filters across all groups instantly. No context switch.    */
/* ------------------------------------------------------------------ */

function ComboboxGroupedModelPicker() {
  const state = useMockModelPickerState();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const highlightedKeyRef = useRef<string | null>(null);

  const allModelKeys = useMemo(
    () =>
      state.instances.flatMap((entry) => entry.models.map((m) => `${entry.instanceId}:${m.slug}`)),
    [state.instances],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.instances
      .map((entry) => ({
        entry,
        models: q
          ? entry.models.filter(
              (m) =>
                m.name.toLowerCase().includes(q) ||
                m.slug.toLowerCase().includes(q) ||
                entry.displayName.toLowerCase().includes(q),
            )
          : entry.models,
      }))
      .filter((g) => g.models.length > 0);
  }, [state.instances, query]);

  const filteredKeys = useMemo(
    () => filtered.flatMap((g) => g.models.map((m) => `${g.entry.instanceId}:${m.slug}`)),
    [filtered],
  );

  const handleSelect = useCallback(
    (modelKey: string) => {
      const colonIndex = modelKey.indexOf(":");
      const instanceId = modelKey.slice(0, colonIndex) as ProviderInstanceId;
      const slug = modelKey.slice(colonIndex + 1);
      state.selectModel(instanceId, slug);
      setOpen(false);
      setQuery("");
    },
    [state],
  );

  return (
    <Combobox
      inline
      items={allModelKeys}
      filteredItems={filteredKeys}
      filter={null}
      autoHighlight
      open={open}
      value={state.selectedKey}
      onOpenChange={setOpen}
      onItemHighlighted={(key) => {
        highlightedKeyRef.current = typeof key === "string" ? key : null;
      }}
      onValueChange={(key) => {
        if (typeof key === "string") handleSelect(key);
      }}
    >
      <div className="relative">
        <TriggerButton
          entry={state.selectedEntry}
          model={state.selectedModel}
          onClick={() => setOpen((o) => !o)}
        />

        <ComboboxPopup>
          <div className="flex min-h-0 w-72 flex-col">
            <div className="shrink-0 border-b border-multi-stroke-tertiary px-1.5 py-1.5">
              <ComboboxInput
                className="[&_input]:font-sans"
                inputClassName="h-7 rounded-multi-control border-0 bg-multi-editor px-2 text-body shadow-none ring-0 placeholder:text-multi-fg-tertiary focus-visible:ring-0"
                placeholder="Search all models..."
                showTrigger={false}
                startAddon={
                  <IconMagnifyingGlass className="size-3.5 shrink-0 text-multi-fg-tertiary" />
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                    return;
                  }
                  if (e.key === "Enter" && highlightedKeyRef.current) {
                    (
                      e as typeof e & { preventBaseUIHandler?: () => void }
                    ).preventBaseUIHandler?.();
                    e.preventDefault();
                    handleSelect(highlightedKeyRef.current);
                    return;
                  }
                }}
                size="sm"
              />
            </div>
            <ScrollArea className="max-h-[min(16rem,calc(var(--available-height)-3rem))]">
              <ComboboxList className="px-1 pb-1">
                {filtered.map((group) => (
                  <ComboboxGroup key={group.entry.instanceId}>
                    <ComboboxGroupLabel className="px-1.5 py-1 text-detail font-medium text-multi-fg-tertiary">
                      <span className="flex items-center gap-1.5">
                        <ProviderInstanceIcon
                          driverKind={group.entry.driverKind}
                          displayName={group.entry.displayName}
                          className="size-4"
                          iconClassName="size-3"
                        />
                        {group.entry.displayName}
                      </span>
                    </ComboboxGroupLabel>
                    {group.models.map((model) => {
                      const modelKey = `${group.entry.instanceId}:${model.slug}`;
                      const isSelected = state.selectedKey === modelKey;
                      const isFav = state.isFavorite(group.entry.instanceId, model.slug);
                      const ProviderIcon =
                        PROVIDER_ICON_BY_PROVIDER[group.entry.driverKind] ?? null;
                      const providerLabel = model.subProvider
                        ? `${group.entry.displayName} \u00b7 ${model.subProvider}`
                        : group.entry.displayName;

                      return (
                        <ComboboxItem
                          key={modelKey}
                          value={modelKey}
                          hideIndicator
                          className={cn(
                            "group cursor-pointer rounded-multi-control px-1.5 py-1 text-body transition-colors",
                            isSelected
                              ? "bg-multi-bg-active text-multi-fg-primary"
                              : "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary data-highlighted:bg-multi-bg-quaternary data-highlighted:text-multi-fg-primary",
                          )}
                          contentClassName="flex w-full items-start gap-1.5"
                        >
                          <span className="mt-px flex size-4 shrink-0 items-center justify-center text-multi-fg-secondary">
                            <IconCheckmark1Small
                              className={cn("size-3.5", isSelected ? "opacity-100" : "opacity-0")}
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center justify-between gap-1.5">
                              <span className="truncate text-body font-medium">
                                {getDisplayModelName(model, { preferShortName: true })}
                              </span>
                              <button
                                type="button"
                                aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                                aria-pressed={isFav}
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-multi-fg-tertiary opacity-85 transition-colors hover:bg-multi-bg-active hover:text-amber-700 hover:opacity-100 dark:hover:text-amber-300"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  state.toggleFavorite(group.entry.instanceId, model.slug);
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                              >
                                <IconStar
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    isFav ? "fill-amber-500 text-amber-500" : "opacity-95",
                                  )}
                                />
                              </button>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1">
                              {ProviderIcon ? <ProviderIcon className="size-3 shrink-0" /> : null}
                              <span className="truncate text-detail text-multi-fg-tertiary">
                                {providerLabel}
                              </span>
                            </div>
                          </div>
                        </ComboboxItem>
                      );
                    })}
                  </ComboboxGroup>
                ))}
              </ComboboxList>
            </ScrollArea>
            <ComboboxEmpty className="py-3 text-xs text-multi-fg-tertiary">
              No models found
            </ComboboxEmpty>
          </div>
        </ComboboxPopup>
      </div>
    </Combobox>
  );
}

/* ComboboxPopup wrapper that matches the real picker's styling */
function ComboboxPopup({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute z-50 mt-1 overflow-hidden rounded-lg border border-multi-stroke-tertiary bg-multi-bg-elevated shadow-multi-popup">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Variant 3: Menu Flat Searchable List                              */
/*  Menu popup with a search input and a flat list of ALL models.     */
/*  Each row shows model name + provider badge. No groups, no rail.   */
/*  Search filters the flat list instantly.                           */
/* ------------------------------------------------------------------ */

function MenuFlatSearchableModelPicker() {
  const state = useMockModelPickerState();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const flatModels = useMemo(
    () =>
      state.instances.flatMap((entry) =>
        entry.models.map((m) => ({ ...m, entry, key: `${entry.instanceId}:${m.slug}` })),
      ),
    [state.instances],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flatModels;
    return flatModels.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q) ||
        m.entry.displayName.toLowerCase().includes(q),
    );
  }, [flatModels, query]);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={<TriggerButton entry={state.selectedEntry} model={state.selectedModel} />}
      />
      <MenuPopup variant="workbench" side="bottom" align="start" sideOffset={4} className="w-72">
        <div className="flex min-h-0 flex-col">
          <div className="shrink-0 border-b border-multi-stroke-tertiary px-1.5 py-1.5">
            <div className="flex h-7 items-center gap-1.5 rounded-multi-control bg-multi-bg-quinary px-2">
              <IconMagnifyingGlass className="size-3 shrink-0 text-multi-fg-tertiary" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search all models..."
                className="min-w-0 flex-1 bg-transparent text-body text-multi-fg-primary outline-none placeholder:text-multi-fg-quaternary"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="shrink-0 rounded p-0.5 text-caption text-multi-fg-quaternary hover:text-multi-fg-secondary"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <ScrollArea className="max-h-[min(15rem,calc(var(--available-height)-3rem))]">
            <div className="flex flex-col gap-0.5 p-1">
              {filtered.map((model) => {
                const isSelected = state.selectedKey === model.key;
                const isFav = state.isFavorite(model.entry.instanceId, model.slug);
                const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[model.entry.driverKind] ?? null;
                const providerLabel = model.subProvider
                  ? `${model.entry.displayName} \u00b7 ${model.subProvider}`
                  : model.entry.displayName;

                return (
                  <MenuItem
                    key={model.key}
                    onClick={() => {
                      state.selectModel(model.entry.instanceId, model.slug);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex items-start gap-1.5 rounded-multi-control px-1.5 py-1 text-body",
                      isSelected
                        ? "bg-multi-bg-active text-multi-fg-primary"
                        : "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary data-highlighted:bg-multi-bg-quaternary data-highlighted:text-multi-fg-primary",
                    )}
                  >
                    <span className="mt-px flex size-4 shrink-0 items-center justify-center text-multi-fg-secondary">
                      <IconCheckmark1Small
                        className={cn("size-3.5", isSelected ? "opacity-100" : "opacity-0")}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center justify-between gap-1.5">
                        <span className="truncate text-body font-medium">
                          {getDisplayModelName(model, { preferShortName: true })}
                        </span>
                        <button
                          type="button"
                          aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                          aria-pressed={isFav}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-multi-fg-tertiary opacity-85 transition-colors hover:bg-multi-bg-active hover:text-amber-700 hover:opacity-100 dark:hover:text-amber-300"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            state.toggleFavorite(model.entry.instanceId, model.slug);
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <IconStar
                            className={cn(
                              "size-3.5 shrink-0",
                              isFav ? "fill-amber-500 text-amber-500" : "opacity-95",
                            )}
                          />
                        </button>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1">
                        {ProviderIcon ? <ProviderIcon className="size-3 shrink-0" /> : null}
                        <span className="truncate text-detail text-multi-fg-tertiary">
                          {providerLabel}
                        </span>
                      </div>
                    </div>
                  </MenuItem>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-body text-multi-fg-tertiary">
                  No models match
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </MenuPopup>
    </Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  Variant 4: Cursor-Style Flat List with Per-Model Settings         */
/*  Inspired by Cursor's model selector: flat list, no provider       */
/*  branding, per-model gear flyout with reasoning + fast toggle.     */
/* ------------------------------------------------------------------ */

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full p-px transition-colors",
        checked ? "bg-emerald-500" : "bg-multi-bg-tertiary",
      )}
    >
      <span
        className={cn(
          "block size-3 rounded-full bg-white shadow-sm transition-transform",
          checked && "translate-x-3",
        )}
      />
    </button>
  );
}

const REASONING_LABEL_MAP: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

function reasoningLabel(level: string) {
  return REASONING_LABEL_MAP[level] ?? level;
}

function CursorStyleModelPicker() {
  const state = useMockModelPickerState();
  const [open, setOpen] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [maxMode, setMaxMode] = useState(false);
  const [query, setQuery] = useState("");
  const [gearOpenFor, setGearOpenFor] = useState<string | null>(null);
  const [modelReasoning, setModelReasoning] = useState<Record<string, string>>({
    "codex:gpt-5-codex": "medium",
    "codex:gpt-5.3-codex": "medium",
    "claudeAgent:claude-opus-4-6": "xhigh",
    "claudeAgent:claude-sonnet-4-6": "high",
    "claudeAgent:claude-haiku-4-5": "low",
    "opencode:github-copilot/claude-opus-4.7": "xhigh",
    "cursor:composer-2": "low",
  });
  const [modelFast, setModelFast] = useState<Record<string, boolean>>({
    "codex:gpt-5-codex": false,
    "codex:gpt-5.3-codex": true,
    "claudeAgent:claude-opus-4-6": false,
    "claudeAgent:claude-sonnet-4-6": false,
    "claudeAgent:claude-haiku-4-5": true,
    "opencode:github-copilot/claude-opus-4.7": false,
    "cursor:composer-2": true,
  });

  const flatModels = useMemo(
    () =>
      state.instances.flatMap((entry) =>
        entry.models.map((m) => ({ ...m, entry, key: `${entry.instanceId}:${m.slug}` })),
      ),
    [state.instances],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flatModels;
    return flatModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q),
    );
  }, [flatModels, query]);

  const capabilityLabel = (key: string) => {
    const r = modelReasoning[key] ?? "medium";
    const f = modelFast[key] ?? false;
    if (f) return "Fast";
    if (r === "xhigh") return "Extra High";
    if (r === "high") return "High";
    if (r === "low") return "Low";
    return "";
  };

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 rounded-full border border-multi-stroke-tertiary bg-multi-bg-quinary px-3 text-body text-multi-fg-secondary"
          >
            <span className="min-w-0 truncate">
              {state.selectedModel
                ? getDisplayModelName(state.selectedModel, { preferShortName: true })
                : "Select model"}
            </span>
            <IconChevronRightMedium className="size-3 shrink-0 rotate-90 opacity-60" />
          </Button>
        }
      />
      <MenuPopup variant="workbench" side="bottom" align="start" sideOffset={4} className="w-64">
        <div className="flex min-h-0 flex-col">
          {/* Search */}
          <div className="shrink-0 border-b border-multi-stroke-tertiary px-2 py-1.5">
            <div className="flex h-6 items-center gap-1.5 rounded-sm bg-multi-bg-quinary px-1.5">
              <IconMagnifyingGlass className="size-3 shrink-0 text-multi-fg-tertiary" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models"
                className="min-w-0 flex-1 bg-transparent text-body text-multi-fg-primary outline-none placeholder:text-multi-fg-quaternary"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="shrink-0 rounded p-0.5 text-[9px] text-multi-fg-quaternary hover:text-multi-fg-secondary"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <ScrollArea className="max-h-[min(16rem,calc(var(--available-height)-3rem))]">
            <div className="flex flex-col">
              {/* Auto toggle */}
              <div className="flex items-center justify-between px-2 py-1.5 text-body">
                <span className="text-multi-fg-primary">Auto</span>
                <ToggleSwitch checked={autoMode} onChange={setAutoMode} />
              </div>
              {/* MAX Mode toggle */}
              <div className="flex items-center justify-between px-2 py-1.5 text-body">
                <span className="text-multi-fg-primary">MAX Mode</span>
                <ToggleSwitch checked={maxMode} onChange={setMaxMode} />
              </div>

              <div className="mx-2 h-px bg-multi-stroke-tertiary" />

              {/* Model list */}
              <div className="flex flex-col gap-px p-1">
                {filtered.map((model) => {
                  const isSelected = state.selectedKey === model.key;
                  const cap = capabilityLabel(model.key);
                  return (
                    <div
                      key={model.key}
                      className={cn(
                        "group flex items-center justify-between rounded-sm px-1.5 py-1 text-body transition-colors",
                        isSelected
                          ? "bg-multi-bg-tertiary text-multi-fg-primary"
                          : "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary",
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        onClick={() => {
                          state.selectModel(model.entry.instanceId, model.slug);
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {getDisplayModelName(model, { preferShortName: true })}
                        </span>
                        {cap && (
                          <span className="shrink-0 text-caption text-multi-fg-tertiary">
                            {cap}
                          </span>
                        )}
                        {isSelected && (
                          <IconCheckmark1Small className="size-3.5 shrink-0 text-multi-fg-secondary" />
                        )}
                      </button>

                      {/* Gear flyout */}
                      <Popover
                        open={gearOpenFor === model.key}
                        onOpenChange={(o) => setGearOpenFor(o ? model.key : null)}
                      >
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-multi-fg-quaternary opacity-0 transition-colors hover:bg-multi-bg-active hover:text-multi-fg-secondary group-hover:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                            />
                          }
                        >
                          <IconSettingsKnob className="size-3" />
                        </PopoverTrigger>
                        <PopoverPopup
                          instant
                          side="inline-end"
                          align="start"
                          sideOffset={4}
                          className="w-40 overflow-hidden rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-elevated py-1 shadow-multi-popup"
                        >
                          <div className="px-2 pb-1 text-caption font-medium uppercase tracking-wider text-multi-fg-quaternary">
                            Reasoning
                          </div>
                          {(["low", "medium", "high", "xhigh"] as const).map((level) => (
                            <button
                              key={level}
                              type="button"
                              className={cn(
                                "flex w-full items-center justify-between px-2 py-1 text-left text-body transition-colors",
                                (modelReasoning[model.key] ?? "medium") === level
                                  ? "text-multi-fg-primary"
                                  : "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary",
                              )}
                              onClick={() => {
                                setModelReasoning((prev) => ({
                                  ...prev,
                                  [model.key]: level,
                                }));
                              }}
                            >
                              <span>{reasoningLabel(level)}</span>
                              {(modelReasoning[model.key] ?? "medium") === level && (
                                <IconCheckmark1Small className="size-3.5 shrink-0 text-multi-fg-secondary" />
                              )}
                            </button>
                          ))}
                          <div className="mx-2 my-1 h-px bg-multi-stroke-tertiary" />
                          <div className="px-2 pb-1 text-caption font-medium uppercase tracking-wider text-multi-fg-quaternary">
                            Options
                          </div>
                          <div className="flex items-center justify-between px-2 py-1">
                            <span className="text-body text-multi-fg-secondary">Fast</span>
                            <ToggleSwitch
                              checked={modelFast[model.key] ?? false}
                              onChange={(v) =>
                                setModelFast((prev) => ({ ...prev, [model.key]: v }))
                              }
                            />
                          </div>
                        </PopoverPopup>
                      </Popover>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="px-3 py-2 text-body text-multi-fg-tertiary">
                    No models match
                  </div>
                )}
              </div>

              <div className="mx-2 h-px bg-multi-stroke-tertiary" />

              {/* Add Models */}
              <button
                type="button"
                className="mx-1 my-1 flex items-center gap-1.5 rounded-sm px-2 py-1 text-left text-body text-multi-fg-secondary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
              >
                <span className="text-multi-fg-tertiary">+</span>
                Add Models
              </button>
            </div>
          </ScrollArea>
        </div>
      </MenuPopup>
    </Menu>
  );
}

/* ================================================================== */
/*  Page Layout                                                       */
/* ================================================================== */

export function ModelPickerVariantsPage() {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Model Picker Variants
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Menu + Combobox combinations with no context switching. Provider selection is always one
            click away.
          </p>
        </div>

        <div className="mb-6 text-detail font-semibold uppercase tracking-wider text-muted-foreground">
          Menu + Combobox Family
        </div>

        <div className="flex flex-col gap-8">
          <VariantCard
            number={1}
            title="Menu Shell + Combobox Rail"
            description="Menu owns the popup shell. Inside: a persistent provider icon rail on the left and an inline Combobox on the right. Click any provider to instantly update the model list. Search filters models within the selected provider. No drill-down, no breadcrumbs."
          >
            <MenuComboboxRailModelPicker />
          </VariantCard>

          <VariantCard
            number={2}
            title="Combobox Grouped"
            description="Pure Combobox with grouped items by provider. Each group has a sticky label with the provider icon. Search filters across all groups instantly. All providers and models are visible in a single flat scrollable list."
          >
            <ComboboxGroupedModelPicker />
          </VariantCard>

          <VariantCard
            number={3}
            title="Menu Flat Searchable List"
            description="Menu popup with a search input and a single flat list of ALL models from ALL providers. Each row shows the model name, provider badge, and favorite toggle. Search filters the entire flat list. No provider rail, no groups — just one scrollable list."
          >
            <MenuFlatSearchableModelPicker />
          </VariantCard>

          <VariantCard
            number={4}
            title="Cursor-Style Flat List with Per-Model Settings"
            description="Inspired by Cursor's model selector: flat list with no provider branding. Top toggles for Auto and MAX Mode. Each model row has a gear icon that opens a flyout with Reasoning levels (Low/Medium/High/Extra High) and a Fast toggle. Inline capability text shows the current setting. Minimal chrome with 1px borders and tiny radius."
          >
            <CursorStyleModelPicker />
          </VariantCard>
        </div>

        <div className="h-20" />
      </div>
    </div>
  );
}

function VariantCard({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-card/80 p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-multi-bg-tertiary text-detail font-semibold text-multi-fg-secondary">
          {number}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-border/60 bg-background/60 px-4 py-6">
        {children}
      </div>
    </section>
  );
}
