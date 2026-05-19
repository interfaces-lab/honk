import {
  type ModelSelection,
  type ProviderInstanceId,
  type ResolvedKeybindingsConfig,
} from "@multi/contracts";
import { normalizeSearchQuery, scoreQueryMatch } from "@multi/shared/search-ranking";
import { memo, useMemo, useState, useCallback, useLayoutEffect, useRef } from "react";
import { IconMagnifyingGlass } from "central-icons";
import { ModelListRow } from "./model-list-row";
import { ModelPickerSidebar } from "./model-sidebar";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxList } from "@multi/ui/combobox";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../../keybindings";
import { useSettings, useUpdateSettings } from "~/hooks/use-settings";
import type { ProviderInstanceEntry } from "../../../model/provider-instances";
import { providerModelKey } from "../../../model/ordering";
import type { AppModelCatalogItem, AppModelResolverStatus } from "../../../model/selection";
import { useMountEffect } from "~/hooks/use-mount-effect";

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();
const MODEL_PICKER_FAVORITE_SCORE_BOOST = 24;
const NEW_MODEL_KEYS = new Set<string>([
  // Add entries as `provider:slug` when freshly shipped models should show a NEW chip.
]);

type ModelPickerSearchableModel = {
  /** Driver kind, indexed so "codex" still matches a Codex Personal instance. */
  driverKind: string;
  /** Instance display name, indexed so custom instance names match directly. */
  providerDisplayName: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isFavorite?: boolean;
};

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

function isModelPickerNewModel(provider: string, slug: string): boolean {
  return NEW_MODEL_KEYS.has(`${provider}:${slug}`);
}

function buildModelPickerSearchText(model: ModelPickerSearchableModel): string {
  return normalizeSearchQuery(
    [model.name, model.shortName, model.subProvider, model.driverKind, model.providerDisplayName]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" "),
  );
}

function getModelPickerSearchFields(model: ModelPickerSearchableModel): string[] {
  return [
    normalizeSearchQuery(model.name),
    ...(model.shortName ? [normalizeSearchQuery(model.shortName)] : []),
    ...(model.subProvider ? [normalizeSearchQuery(model.subProvider)] : []),
    normalizeSearchQuery(model.driverKind),
    normalizeSearchQuery(model.providerDisplayName),
    buildModelPickerSearchText(model),
  ];
}

function scoreModelPickerSearchToken(
  field: string,
  token: string,
  fieldBase: number,
): number | null {
  return scoreQueryMatch({
    value: field,
    query: token,
    exactBase: fieldBase,
    prefixBase: fieldBase + 2,
    boundaryBase: fieldBase + 4,
    includesBase: fieldBase + 6,
    ...(token.length >= 3 ? { fuzzyBase: fieldBase + 100 } : {}),
  });
}

function scoreModelPickerSearch(model: ModelPickerSearchableModel, query: string): number | null {
  const tokens = normalizeSearchQuery(query)
    .split(/\s+/u)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return 0;
  }

  const fields = getModelPickerSearchFields(model);
  let score = 0;

  for (const token of tokens) {
    const tokenScores = fields
      .map((field, index) => scoreModelPickerSearchToken(field, token, index * 10))
      .filter((fieldScore): fieldScore is number => fieldScore !== null);

    if (tokenScores.length === 0) {
      return null;
    }

    score += Math.min(...tokenScores);
  }

  return model.isFavorite ? score - MODEL_PICKER_FAVORITE_SCORE_BOOST : score;
}

function sortModelPickerItems(
  items: ReadonlyArray<AppModelCatalogItem>,
  options: {
    readonly favoriteModelKeys: ReadonlySet<string>;
    readonly groupFavorites: boolean;
    readonly instanceOrder: ReadonlyArray<ProviderInstanceId>;
  },
): AppModelCatalogItem[] {
  const instanceRank = new Map(
    options.instanceOrder.map((instanceId, index) => [instanceId, index] as const),
  );
  const originalRank = new Map(
    items.map((item, index) => [providerModelKey(item.instanceId, item.slug), index] as const),
  );

  return items.toSorted((a, b) => {
    const aKey = providerModelKey(a.instanceId, a.slug);
    const bKey = providerModelKey(b.instanceId, b.slug);

    if (options.groupFavorites) {
      const aFavorite = options.favoriteModelKeys.has(aKey);
      const bFavorite = options.favoriteModelKeys.has(bKey);
      if (aFavorite !== bFavorite) {
        return aFavorite ? -1 : 1;
      }
    }

    const instanceDelta =
      (instanceRank.get(a.instanceId) ?? Number.POSITIVE_INFINITY) -
      (instanceRank.get(b.instanceId) ?? Number.POSITIVE_INFINITY);
    if (instanceDelta !== 0) {
      return instanceDelta;
    }

    return (
      (originalRank.get(aKey) ?? Number.POSITIVE_INFINITY) -
      (originalRank.get(bKey) ?? Number.POSITIVE_INFINITY)
    );
  });
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
  availabilityStatus?: AppModelResolverStatus | undefined;
  modelCatalogItems: ReadonlyArray<AppModelCatalogItem>;
  terminalOpen: boolean;
  /** When the host popover opens, mirror this for search seeding (e.g. `/model` query). */
  popoverOpen: boolean;
  /**
   * Applied when `popoverOpen` transitions from closed to open. `undefined` leaves the
   * previous search query; a string (including `""`) replaces it.
   */
  openSearchSeed?: string | undefined;
  onRequestClose?: () => void;
  onSelectionChange: (selection: ModelSelection) => void;
}) {
  const {
    keybindings: providedKeybindings,
    modelCatalogItems,
    instanceEntries,
    onSelectionChange,
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

  const flatModels = modelCatalogItems;

  const flatModelByKey = useMemo(
    (): ReadonlyMap<string, AppModelCatalogItem> =>
      new Map(flatModels.map((model) => [providerModelKey(model.instanceId, model.slug), model])),
    [flatModels],
  );

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
            model: AppModelCatalogItem;
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

    return sortModelPickerItems(result, {
      favoriteModelKeys: favoritesSet,
      groupFavorites: true,
      instanceOrder: sortOrder,
    });
  }, [favoritesSet, flatModels, instanceOrder, railSelection, searchQuery]);

  const handleModelSelect = useCallback(
    (modelSlug: string, instanceId: ProviderInstanceId) => {
      const selectedItem = flatModelByKey.get(providerModelKey(instanceId, modelSlug));
      if (!selectedItem || selectedItem.selectable === false) {
        return;
      }
      onSelectionChange(selectedItem.modelSelection);
    },
    [flatModelByKey, onSelectionChange],
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
      mapping.set(providerModelKey(model.instanceId, model.slug), jumpCommand);
      selectableModelIndex += 1;
    }
    return mapping;
  }, [filteredModels]);
  const modelJumpModelKeys = useMemo(
    () => [...modelJumpCommandByKey.keys()],
    [modelJumpCommandByKey],
  );
  const allModelKeys = useMemo(
    (): string[] => flatModels.map((model) => providerModelKey(model.instanceId, model.slug)),
    [flatModels],
  );
  const filteredModelKeys = useMemo(
    (): string[] => filteredModels.map((model) => providerModelKey(model.instanceId, model.slug)),
    [filteredModels],
  );
  const availabilityMessage =
    props.availabilityStatus && props.availabilityStatus.kind !== "ready"
      ? props.availabilityStatus.message
      : null;
  const emptyMessage = searchQuery.trim()
    ? "No models found"
    : (availabilityMessage ?? "No models found");
  const filteredModelByKey = useMemo(
    (): ReadonlyMap<string, AppModelCatalogItem> =>
      new Map(
        filteredModels.map((model) => [providerModelKey(model.instanceId, model.slug), model]),
      ),
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
  const handleModelSelectRef = useRef(handleModelSelect);
  const keybindingsRef = useRef(keybindings);
  const modelJumpModelKeysRef = useRef(modelJumpModelKeys);
  const modelJumpShortcutContextRef = useRef(modelJumpShortcutContext);
  handleModelSelectRef.current = handleModelSelect;
  keybindingsRef.current = keybindings;
  modelJumpModelKeysRef.current = modelJumpModelKeys;
  modelJumpShortcutContextRef.current = modelJumpShortcutContext;

  useMountEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindingsRef.current, {
        platform: navigator.platform,
        context: modelJumpShortcutContextRef.current,
      });
      const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetModelKey = modelJumpModelKeysRef.current[jumpIndex];
      if (!targetModelKey) {
        return;
      }
      const { instanceId, slug } = splitInstanceModelKey(targetModelKey);
      event.preventDefault();
      event.stopPropagation();
      handleModelSelectRef.current(slug, instanceId);
    };

    window.addEventListener("keydown", onWindowKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  });

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
              showPendingProviders
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

              <div ref={listRegionRef} className="relative flex min-h-0 flex-1 flex-col">
                {availabilityMessage ? (
                  <div
                    className="border-b border-multi-stroke-tertiary px-2 py-1.5 text-xs/4 text-multi-fg-tertiary"
                    data-model-picker-status-message="true"
                    role="status"
                  >
                    {availabilityMessage}
                  </div>
                ) : null}
                <ComboboxList
                  className="model-picker-list min-h-0 flex-1 px-1 pb-1"
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
                {emptyMessage}
              </ComboboxEmpty>
            </div>
          </Combobox>
        </div>
      </div>
    </div>
  );
});
