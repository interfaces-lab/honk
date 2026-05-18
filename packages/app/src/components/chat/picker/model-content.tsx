import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@multi/contracts";
import { resolveSelectableModel } from "@multi/shared/model";
import { memo, useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { IconMagnifyingGlass } from "central-icons";
import { ModelListRow } from "./model-list-row";
import { ModelPickerSidebar } from "./model-sidebar";
import { isModelPickerNewModel } from "./model-picker-model-highlights";
import { buildModelPickerSearchText, scoreModelPickerSearch } from "./model-search";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxList } from "@multi/ui/combobox";
import { ModelEsque } from "./icon-utils";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../../keybindings";
import { useSettings, useUpdateSettings } from "~/hooks/use-settings";
import type { ProviderInstanceEntry } from "../../../model/provider-instances";
import { providerModelKey, sortProviderModelItems } from "../../../model/ordering";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
  instanceAccentColor?: string | undefined;
  continuationGroupKey?: string | undefined;
  selectable?: boolean | undefined;
};

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();

// Split a `${instanceId}:${slug}` combobox key back into its pieces. Slugs
// can contain colons (e.g. some vendor model ids), so we only split on the
// first colon — anything after that is the slug.
function splitInstanceModelKey(key: string): { instanceId: ProviderInstanceId; slug: string } {
  const colonIndex = key.indexOf(":");
  if (colonIndex === -1) {
    return { instanceId: key as ProviderInstanceId, slug: "" };
  }
  return {
    instanceId: key.slice(0, colonIndex) as ProviderInstanceId,
    slug: key.slice(colonIndex + 1),
  };
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  /** The instance currently selected in the composer (combobox "value"). */
  activeInstanceId: ProviderInstanceId;
  model: string;
  /**
   * All configured provider instances in display order. Used to resolve
   * display names and sort model rows by the active composer instance first.
   */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  /**
   * Model options per instance. Keyed by `ProviderInstanceId` so the
   * default Codex instance and any custom Codex instances each have their
   * own list (custom instances typically start with the same built-in
   * model set but are free to diverge via customModels).
   */
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  terminalOpen: boolean;
  /** When the host popover opens, mirror this for search seeding (e.g. `/model` query). */
  popoverOpen: boolean;
  /**
   * Applied when `popoverOpen` transitions from closed to open. `undefined` leaves the
   * previous search query; a string (including `""`) replaces it.
   */
  openSearchSeed?: string | undefined;
  onRequestClose?: () => void;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const {
    keybindings: providedKeybindings,
    modelOptionsByInstance,
    instanceEntries,
    onInstanceModelChange,
  } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const [railSelection, setRailSelection] = useState<ProviderInstanceId | "favorites">(
    () => props.activeInstanceId,
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const highlightedModelKeyRef = useRef<string | null>(null);
  const activeInstanceIdRef = useRef(props.activeInstanceId);
  activeInstanceIdRef.current = props.activeInstanceId;
  const favorites = useSettings((s) => s.favorites ?? []);
  const keybindings = useMemo<ResolvedKeybindingsConfig>(
    () => providedKeybindings ?? [],
    [providedKeybindings],
  );

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const popoverWasOpenRef = useRef(false);
  useLayoutEffect(() => {
    const open = props.popoverOpen;
    if (!open) {
      popoverWasOpenRef.current = false;
      return;
    }
    const justOpened = !popoverWasOpenRef.current;
    popoverWasOpenRef.current = true;
    if (justOpened) {
      setRailSelection(activeInstanceIdRef.current);
    }
    if (justOpened && props.openSearchSeed !== undefined) {
      setSearchQuery(props.openSearchSeed);
    }
    if (justOpened) {
      const frame = window.requestAnimationFrame(() => {
        focusSearchInput();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [focusSearchInput, props.openSearchSeed, props.popoverOpen]);

  // Create a Set for efficient lookup. Favorites are keyed by
  // `${instanceId}:${slug}`; built-in instance ids match their driver slugs.
  const favoritesSet = useMemo(() => {
    return new Set(favorites.map((fav) => providerModelKey(fav.provider, fav.model)));
  }, [favorites]);

  const { updateSettings } = useUpdateSettings();
  const toggleModelFavorite = useCallback(
    (instanceId: ProviderInstanceId, slug: string) => {
      const next = [...favorites];
      const existingIdx = next.findIndex(
        (item) => item.provider === instanceId && item.model === slug,
      );
      if (existingIdx >= 0) {
        next.splice(existingIdx, 1);
      } else {
        next.push({ provider: instanceId, model: slug });
      }
      updateSettings({ favorites: next });
    },
    [favorites, updateSettings],
  );

  /**
   * Lookup table keyed by `instanceId`. Used for display name + driver
   * kind enrichment and for `ready`/enabled filtering before flattening
   * models into the search list.
   */
  const entryByInstanceId = useMemo(
    () => new Map(instanceEntries.map((entry) => [entry.instanceId, entry])),
    [instanceEntries],
  );

  const readyInstanceSet = useMemo(() => {
    const ready = new Set<ProviderInstanceId>();
    for (const entry of instanceEntries) {
      if (entry.status === "ready") {
        ready.add(entry.instanceId);
      }
    }
    return ready;
  }, [instanceEntries]);

  // Flatten models into a searchable array. One pass over the
  // instance-keyed map; each model carries its instance id + driver kind
  // so the list row can render the right icon and display name without
  // another lookup.
  const flatModels = useMemo(() => {
    const out: ModelPickerItem[] = [];
    for (const [instanceId, models] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        // Instance disappeared between renders (configuration change). Skip
        // its models — stale options shouldn't appear in the picker.
        continue;
      }
      if (!readyInstanceSet.has(instanceId)) {
        continue;
      }
      for (const model of models) {
        out.push({
          slug: model.slug,
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          ...(model.selectable === false ? { selectable: false } : {}),
          instanceId,
          driverKind: entry.driverKind,
          instanceDisplayName: entry.displayName,
          ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
          ...(entry.continuationGroupKey
            ? { continuationGroupKey: entry.continuationGroupKey }
            : {}),
        });
      }
    }
    return out;
  }, [modelOptionsByInstance, entryByInstanceId, readyInstanceSet]);

  const instanceOrder = useMemo(
    () => [
      props.activeInstanceId,
      ...instanceEntries
        .map((entry) => entry.instanceId)
        .filter((instanceId) => instanceId !== props.activeInstanceId),
    ],
    [instanceEntries, props.activeInstanceId],
  );

  // Filter models based on search query and selected instance
  const filteredModels = useMemo(() => {
    // Apply tokenized fuzzy search across the combined provider/model search fields.
    if (searchQuery.trim()) {
      const rankedMatches = flatModels
        .map((model) => ({
          model,
          score: scoreModelPickerSearch(
            {
              name: model.name,
              ...(model.shortName ? { shortName: model.shortName } : {}),
              ...(model.subProvider ? { subProvider: model.subProvider } : {}),
              driverKind: model.driverKind,
              providerDisplayName: model.instanceDisplayName,
              isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
            },
            searchQuery,
          ),
          isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
          tieBreaker: buildModelPickerSearchText({
            name: model.name,
            ...(model.shortName ? { shortName: model.shortName } : {}),
            ...(model.subProvider ? { subProvider: model.subProvider } : {}),
            driverKind: model.driverKind,
            providerDisplayName: model.instanceDisplayName,
          }),
        }))
        .filter(
          (
            rankedModel,
          ): rankedModel is {
            model: ModelPickerItem;
            score: number;
            isFavorite: boolean;
            tieBreaker: string;
          } => rankedModel.score !== null,
        );

      return rankedMatches
        .toSorted((a, b) => {
          const scoreDelta = a.score - b.score;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }
          if (a.isFavorite !== b.isFavorite) {
            return a.isFavorite ? -1 : 1;
          }
          return a.tieBreaker.localeCompare(b.tieBreaker);
        })
        .map((rankedModel) => rankedModel.model);
    }

    let result = flatModels;

    const trimmedSearch = searchQuery.trim();
    if (!trimmedSearch) {
      if (railSelection === "favorites") {
        result = result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)));
      } else {
        result = result.filter((m) => m.instanceId === railSelection);
      }
    }

    let sortOrder = instanceOrder;
    if (!trimmedSearch && railSelection !== "favorites") {
      const rid = railSelection;
      sortOrder = [rid, ...instanceOrder.filter((instanceId) => instanceId !== rid)];
    }

    return sortProviderModelItems(result, {
      favoriteModelKeys: favoritesSet,
      groupFavorites: true,
      instanceOrder: sortOrder,
    });
  }, [favoritesSet, flatModels, instanceOrder, railSelection, searchQuery]);

  const handleModelSelect = useCallback(
    (modelSlug: string, instanceId: ProviderInstanceId) => {
      const options = modelOptionsByInstance.get(instanceId);
      if (!options) {
        return;
      }
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        return;
      }
      const selectableOptions = options.filter((option) => option.selectable !== false);
      // `resolveSelectableModel` uses the driver kind for normalization
      // (slug casing etc.). Custom instances share their driver's
      // normalization rules, so pass the driver kind here.
      const resolvedModel = resolveSelectableModel(entry.driverKind, modelSlug, selectableOptions);
      if (resolvedModel) {
        onInstanceModelChange(instanceId, resolvedModel);
      }
    },
    [entryByInstanceId, modelOptionsByInstance, onInstanceModelChange],
  );

  const modelJumpCommandByKey = useMemo(() => {
    const mapping = new Map<
      string,
      NonNullable<ReturnType<typeof modelPickerJumpCommandForIndex>>
    >();
    let selectableModelIndex = 0;
    for (const model of filteredModels) {
      if (model.selectable === false) {
        continue;
      }
      const jumpCommand = modelPickerJumpCommandForIndex(selectableModelIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(`${model.instanceId}:${model.slug}`, jumpCommand);
      selectableModelIndex += 1;
    }
    return mapping;
  }, [filteredModels]);
  const modelJumpModelKeys = useMemo(
    () => [...modelJumpCommandByKey.keys()],
    [modelJumpCommandByKey],
  );
  const allModelKeys = useMemo(
    (): string[] => flatModels.map((model) => `${model.instanceId}:${model.slug}`),
    [flatModels],
  );
  const filteredModelKeys = useMemo(
    (): string[] => filteredModels.map((model) => `${model.instanceId}:${model.slug}`),
    [filteredModels],
  );
  const filteredModelByKey = useMemo(
    (): ReadonlyMap<string, ModelPickerItem> =>
      new Map(filteredModels.map((model) => [`${model.instanceId}:${model.slug}`, model] as const)),
    [filteredModels],
  );
  const modelJumpShortcutContext = useMemo(
    () =>
      ({
        terminalFocus: false,
        terminalOpen: props.terminalOpen,
        modelPickerOpen: true,
      }) as const,
    [props.terminalOpen],
  );
  const modelJumpLabelByKey = useMemo((): ReadonlyMap<string, string> => {
    if (modelJumpCommandByKey.size === 0) {
      return EMPTY_MODEL_JUMP_LABELS;
    }
    const shortcutLabelOptions = {
      platform: navigator.platform,
      context: modelJumpShortcutContext,
    };
    const mapping = new Map<string, string>();
    for (const [modelKey, command] of modelJumpCommandByKey) {
      const label = shortcutLabelForCommand(keybindings, command, shortcutLabelOptions);
      if (label) {
        mapping.set(modelKey, label);
      }
    }
    return mapping.size > 0 ? mapping : EMPTY_MODEL_JUMP_LABELS;
  }, [keybindings, modelJumpCommandByKey, modelJumpShortcutContext]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: modelJumpShortcutContext,
      });
      const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetModelKey = modelJumpModelKeys[jumpIndex];
      if (!targetModelKey) {
        return;
      }
      const { instanceId, slug } = splitInstanceModelKey(targetModelKey);
      event.preventDefault();
      event.stopPropagation();
      handleModelSelect(slug, instanceId);
    };

    window.addEventListener("keydown", onWindowKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [handleModelSelect, keybindings, modelJumpModelKeys, modelJumpShortcutContext]);

  const sidebarVisible = !searchQuery.trim();
  const handleSidebarInstanceSelect = useCallback(
    (next: ProviderInstanceId | "favorites") => {
      setRailSelection(next);
      window.requestAnimationFrame(() => {
        focusSearchInput();
      });
    },
    [focusSearchInput],
  );

  return (
    <div className="relative flex max-h-64 min-h-0 w-72 max-w-full min-w-64 flex-col overflow-hidden rounded-lg border border-multi-stroke-tertiary bg-multi-bg-elevated font-multi text-body text-multi-fg-primary shadow-multi-popup backdrop-blur-[18px]">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 w-12 shrink-0 flex-col">
          {sidebarVisible ? (
            <ModelPickerSidebar
              selectedInstanceId={railSelection}
              instanceEntries={instanceEntries}
              showFavorites
              showComingSoon
              onSelectInstance={handleSidebarInstanceSelect}
            />
          ) : (
            <div
              aria-hidden
              className="min-h-[1px] min-w-12 flex-1 border-r border-multi-stroke-tertiary bg-[color-mix(in_srgb,var(--multi-bg-secondary)_72%,transparent)]"
            />
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Combobox
            inline
            items={allModelKeys}
            filteredItems={filteredModelKeys}
            filter={null}
            autoHighlight
            open
            value={`${props.activeInstanceId}:${props.model}`}
            onItemHighlighted={(modelKey) => {
              highlightedModelKeyRef.current = typeof modelKey === "string" ? modelKey : null;
            }}
            onValueChange={(modelKey) => {
              if (typeof modelKey !== "string") {
                return;
              }
              const { instanceId, slug } = splitInstanceModelKey(modelKey);
              handleModelSelect(slug, instanceId);
            }}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-multi-bg-elevated">
              <div className="bg-multi-bg-elevated px-1.5 pt-1.5 pb-1">
                <ComboboxInput
                  ref={searchInputRef}
                  className="[&_input]:font-sans"
                  inputClassName="h-7 rounded-multi-control border-0 bg-multi-editor px-2 text-body shadow-none ring-0 placeholder:text-multi-fg-tertiary focus-visible:ring-0"
                  placeholder="Search models..."
                  showTrigger={false}
                  startAddon={
                    <IconMagnifyingGlass className="size-3.5 shrink-0 text-multi-fg-tertiary" />
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      props.onRequestClose?.();
                      return;
                    }
                    if (e.key === "Enter" && highlightedModelKeyRef.current) {
                      (
                        e as typeof e & { preventBaseUIHandler?: () => void }
                      ).preventBaseUIHandler?.();
                      e.preventDefault();
                      e.stopPropagation();
                      const { instanceId, slug } = splitInstanceModelKey(
                        highlightedModelKeyRef.current,
                      );
                      handleModelSelect(slug, instanceId);
                      return;
                    }
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  size="sm"
                />
              </div>

              <div ref={listRegionRef} className="relative min-h-0 flex-1">
                <ComboboxList
                  className="model-picker-list size-full px-1 pb-1"
                  data-model-picker-list="true"
                >
                  {filteredModelKeys.map((modelKey, index) => {
                    const model = filteredModelByKey.get(modelKey);
                    if (!model) {
                      return null;
                    }
                    const fk = providerModelKey(model.instanceId, model.slug);
                    return (
                      <ModelListRow
                        key={modelKey}
                        index={index}
                        model={model}
                        instanceId={model.instanceId}
                        driverKind={model.driverKind}
                        providerDisplayName={model.instanceDisplayName}
                        providerAccentColor={model.instanceAccentColor}
                        isSelected={
                          model.instanceId === props.activeInstanceId && model.slug === props.model
                        }
                        showProvider
                        preferShortName
                        useTriggerLabel={false}
                        showNewBadge={isModelPickerNewModel(model.driverKind, model.slug)}
                        jumpLabel={modelJumpLabelByKey.get(modelKey) ?? null}
                        showFavoriteToggle={model.selectable !== false}
                        isFavorite={favoritesSet.has(fk)}
                        onFavoriteClick={() => toggleModelFavorite(model.instanceId, model.slug)}
                      />
                    );
                  })}
                </ComboboxList>
              </div>
              <ComboboxEmpty className="not-empty:py-5 empty:h-0 text-xs/4 font-normal text-multi-fg-tertiary">
                No models found
              </ComboboxEmpty>
            </div>
          </Combobox>
        </div>
      </div>
    </div>
  );
});
